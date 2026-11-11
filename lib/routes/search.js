'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render, render403 } = require('../template');
const { json, buildNav, limitMessage } = require('./_helpers');
const { withSiteName } = require('./home');
const { checkDual } = require('../auth/privilege');
const PAGE_SIZE = 50;
const MAX_LIMIT = 100;
function canAccessDomain(user, dn) {
    try {
        checkDual(user, auth.getDomainUser(dn, user), 'view_discussion');
        return true;
    } catch (e) {
        return false;
    }
}
function parseAdvanced(q) {
    let s = String(q || '').replace(/[\u0000-\u001F\u007F]/g, '');
    const literals = [];
    s = s.replace(/"([^"]*)"/g, (whole, content) => {
        const idx = literals.length;
        literals.push(content);
        return '\u0001' + idx + '\u0001';
    });
    const tokens = s.split(/\s+/).filter(Boolean);
    const filters = {
        keywords: [], from: '', in: '', domain: '',
        before: '', after: '',
    };
    for (const raw of tokens) {
        const pureMatch = raw.match(/^\u0001(\d+)\u0001$/);
        const t = raw.replace(/\u0001(\d+)\u0001/g, (whole, idx) => {
            const v = literals[parseInt(idx, 10)];
            return v == null ? '' : v;
        });
        if (pureMatch) {
            if (t) filters.keywords.push(t);
            continue;
        }
        const m = t.match(/^(from|in|domain|before|after):(.+)$/);
        if (!m) {
            filters.keywords.push(t);
            continue;
        }
        const key = m[1];
        const val = m[2];
        if (key === 'before' || key === 'after') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) continue;
            if (isNaN(Date.parse(val))) continue;
            if (new Date(Date.parse(val)).toISOString().slice(0, 10) !== val) continue;
        }
        filters[key] = val;
    }
    return filters;
}
function encodeCursor(item) {
    return Buffer.from(JSON.stringify({
        t: item.created_at || '',
        id: item.msg_id,
    }), 'utf8').toString('base64url');
}
function decodeCursor(raw) {
    if (!raw) return null;
    try {
        const obj = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
        if (!obj || typeof obj.t !== 'string' || typeof obj.id !== 'string') return null;
        return obj;
    } catch (e) {
        return null;
    }
}
function sortTime(item) {
    return item.t !== undefined ? item.t : (item.created_at || '');
}
function sortId(item) {
    return item.id !== undefined ? item.id : item.msg_id;
}
function newer(a, b) {
    const at = sortTime(a), bt = sortTime(b);
    if (at !== bt) return at > bt ? -1 : 1;
    const ai = String(sortId(a) || ''), bi = String(sortId(b) || '');
    if (ai !== bi) return ai > bi ? -1 : 1;
    return 0;
}
function topInserter(limit) {
    const arr = [];
    return {
        add: function (item) {
            if (arr.length > limit && newer(item, arr[arr.length - 1]) >= 0) return;
            let lo = 0, hi = arr.length;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (newer(item, arr[mid]) < 0) hi = mid;
                else lo = mid + 1;
            }
            arr.splice(lo, 0, item);
            if (arr.length > limit + 1) arr.pop();
        },
        items: function () { return arr; },
    };
}
route('GET', '/search', ({ res, user, query, req }) => {
    const limiter = require('../rate-limit');
    const sKeys = {
        ip: (req && req._clientIp) || '',
        account: user && user.id ? user.id : '',
    };
    const sLimited = limiter.check('search', sKeys);
    if (sLimited) {
        return render403(res, limitMessage('搜索', sLimited));
    }
    limiter.note('search', sKeys);
    const q = (query.q || '').trim();
    let domainFilter = (query.domain || '').trim();
    let discFilter = (query.discuss || '').trim();
    let userFilter = (query.user || '').trim();
    const f = parseAdvanced(q);
    if (f.from) userFilter = userFilter || f.from;
    if (f.in) discFilter = discFilter || f.in;
    if (f.domain) domainFilter = domainFilter || f.domain;
    const invalidDisc = !!discFilter && !/^[a-z0-9_-]{1,32}$/.test(discFilter);
    if (invalidDisc) discFilter = '';
    const limit = Math.max(1, Math.min(
        parseInt(query.limit, 10) || PAGE_SIZE, MAX_LIMIT));
    const cursorRaw = String(query.cursor || '').slice(0, 2048);
    const cursor = decodeCursor(cursorRaw);
    const wantsJson = String((req && req.headers && req.headers.accept) || '')
        .indexOf('application/json') >= 0 || query.format === 'json';
    const accessibleDomains = [];
    for (const dn of storage.listAllDomains()) {
        if (!canAccessDomain(user, dn)) continue;
        const d = storage.loadDomain(dn);
        accessibleDomains.push({
            name: dn,
            display: d.display_name || dn,
            discussions: storage.listDiscussions(dn),
        });
    }
    const allUsers = wantsJson ? [] : storage.listRealUsers().map(u => ({
        id: u.id,
        nickname: u.nickname || '?',
    }));
    let total = 0;
    let afterCursor = 0;
    const top = topInserter(limit);
    if (q && !invalidDisc) {
        const keywords = f.keywords;
        const searchTargets = domainFilter
            ? [domainFilter]
            : accessibleDomains.map(d => d.name);
        for (const dn of searchTargets) {
            if (!canAccessDomain(user, dn)) continue;
            const discussions = discFilter
                ? [discFilter]
                : storage.listDiscussions(dn);
            for (const disc of discussions) {
                storage.searchIndex.forEachMatch(dn, disc, keywords, doc => {
                    if (userFilter && doc.u !== userFilter) return;
                    const at = doc.t || '';
                    if (f.after && at < f.after) return;
                    if (f.before && at >= f.before) return;
                    total++;
                    const item = {
                        domain: dn,
                        disc,
                        msg_id: doc.id,
                        user_id: doc.u,
                        nickname: doc.n || '?',
                        content: storage.sliceChars(doc.c, 200),
                        created_at: at,
                    };
                    if (cursor && newer(item, cursor) <= 0) return;
                    afterCursor++;
                    top.add(item);
                });
            }
        }
    }
    const hasMore = afterCursor > limit;
    const pageItems = top.items().slice(0, limit);
    const nextCursor = hasMore && pageItems.length
        ? encodeCursor(pageItems[pageItems.length - 1]) : '';
    if (wantsJson) {
        return json(res, 200, {
            ok: true,
            results: pageItems,
            total,
            limit,
            next_cursor: nextCursor,
            has_more: hasMore,
        });
    }
    render(res, 'search.html', withSiteName({
        current_user: user || {},
        nav: buildNav(user),
        q, domainFilter, discFilter, userFilter,
        searched: !!q,
        domains: accessibleDomains,
        users: allUsers,
        results: pageItems,
        total,
        limit,
        has_more: hasMore,
        next_cursor: nextCursor,
        cursor: cursorRaw,
    }));
});
module.exports = {
    parseAdvanced,
    encodeCursor,
    decodeCursor,
    newer,
    topInserter,
    PAGE_SIZE,
    MAX_LIMIT,
};

'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render } = require('../template');
const { buildNav } = require('./_helpers');
const { withSiteName } = require('./home');
const { checkDual } = require('../auth/privilege');

const MAX_RESULTS = 200;

function canAccessDomain(user, dn) {
    try {
        checkDual(user, auth.getDomainUser(dn, user), 'view_discussion');
        return true;
    } catch (e) {
        return false;
    }
}

function parseAdvanced(q) {
    // 剥离控制字符
    let s = String(q || '').replace(/[\u0000-\u001F\u007F]/g, '');

    // 引号转哨兵
    const literals = [];
    s = s.replace(/"([^"]*)"/g, (whole, content) => {
        const idx = literals.length;
        literals.push(content);
        return '\u0001' + idx + '\u0001';
    });

    // 3. 分词
    const tokens = s.split(/\s+/).filter(Boolean);
    const filters = {
        keywords: [], from: '', in: '', domain: '',
        before: '', after: '',
    };

    for (const raw of tokens) {
        // 判断纯字面量
        const pureMatch = raw.match(/^\u0001(\d+)\u0001$/);

        // 哨兵还原
        const t = raw.replace(/\u0001(\d+)\u0001/g, (whole, idx) => {
            const v = literals[parseInt(idx, 10)];
            return v == null ? '' : v;
        });

        // 字面量作关键词
        if (pureMatch) {
            if (t) filters.keywords.push(t);
            continue;
        }

        // 7. 过滤器解析
        const m = t.match(/^(from|in|domain|before|after):(.+)$/);
        if (!m) {
            filters.keywords.push(t);
            continue;
        }
        const key = m[1];
        const val = m[2];

        // 日期三步校验
        if (key === 'before' || key === 'after') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) continue;
            if (isNaN(Date.parse(val))) continue;
            if (new Date(Date.parse(val)).toISOString().slice(0, 10) !== val) continue;
        }

        filters[key] = val;
    }

    return filters;
}

route('GET', '/search', ({ res, user, query }) => {
    const q = (query.q || '').trim();
    let domainFilter = (query.domain || '').trim();
    let discFilter = (query.discuss || '').trim();
    let userFilter = (query.user || '').trim();

    // 高级语法常开
    const f = parseAdvanced(q);
    if (f.from) userFilter = userFilter || f.from;
    if (f.in) discFilter = discFilter || f.in;
    if (f.domain) domainFilter = domainFilter || f.domain;

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

    const allUsers = storage.listRealUsers().map(u => ({
        id: u.id,
        nickname: u.nickname || '?',
    }));

    let results = [];
    if (q) {
        const keywords = f.keywords.map(k => k.toLowerCase());
        const searchTargets = domainFilter
            ? [domainFilter]
            : accessibleDomains.map(d => d.name);
        for (const dn of searchTargets) {
            if (!canAccessDomain(user, dn)) continue;
            const discussions = discFilter
                ? [discFilter]
                : storage.listDiscussions(dn);
            for (const disc of discussions) {
                const msgs = storage.loadAllMessages(dn, disc);
                for (const m of msgs) {
                    if (m.deleted || m.revoked) continue;
                    if (userFilter && m.user_id !== userFilter) continue;
                    if (!m.content) continue;
                    const lower = m.content.toLowerCase();
                    if (keywords.some(k => lower.indexOf(k) < 0)) continue;
                    const at = m.created_at || '';
                    if (f.after && at < f.after) continue;
                    if (f.before && at >= f.before) continue;
                    results.push({
                        domain: dn,
                        disc,
                        msg_id: m.id,
                        user_id: m.user_id,
                        nickname: m.nickname || '?',
                        content: storage.sliceChars(m.content, 200),
                        created_at: at,
                    });
                    if (results.length >= MAX_RESULTS) break;
                }
                if (results.length >= MAX_RESULTS) break;
            }
            if (results.length >= MAX_RESULTS) break;
        }
        results.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }

    render(res, 'search.html', withSiteName({
        current_user: user || {},
        nav: buildNav(user),
        q, domainFilter, discFilter, userFilter,
        searched: !!q,
        domains: accessibleDomains,
        users: allUsers,
        results,
    }));
});

module.exports = {};

'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render } = require('../template');
const { buildNav } = require('./_helpers');
const { withSiteName } = require('./home');
const { PERM, PRIV, hasPerm, hasPriv } = require('../permissions');

const MAX_RESULTS = 200;

function canAccessDomain(user, dn) {
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW_DISCUSSION)) return false;
    if (!du.is_member && !(user && hasPriv(user, 'base', PRIV.BASE.VIEW_ALL_DOMAIN))) {
        return false;
    }
    return true;
}

function parseAdvanced(q) {
    const tokens = q.split(/\s+/);
    const filters = {
        keywords: [], from: '', in: '', domain: '', before: '', after: '',
    };
    for (const t of tokens) {
        if (!t) continue;
        const m = t.match(/^(from|in|domain|before|after):(.+)$/);
        if (m) {
            const key = m[1];
            const val = m[2];
            // 日期格式校验：非法则丢弃该 token（否则字符串比较恒成立，静默返回错误结果）
            if ((key === 'before' || key === 'after')
                && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
                continue;
            }
            filters[key] = val;
        } else {
            filters.keywords.push(t);
        }
    }
    return filters;
}

route('GET', '/search', ({ res, user, query }) => {
    const q = (query.q || '').trim();
    let domainFilter = (query.domain || '').trim();
    let discFilter = (query.discuss || '').trim();
    let userFilter = (query.user || '').trim();
    const advanced = query.mode === 'advanced';

    let adv = null;
    if (advanced) {
        adv = parseAdvanced(q);
        if (adv.from) userFilter = userFilter || adv.from;
        if (adv.in) discFilter = discFilter || adv.in;
        if (adv.domain) domainFilter = domainFilter || adv.domain;
    }

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
        const needle = advanced ? '' : q.toLowerCase();
        const keywords = advanced
            ? adv.keywords.map(k => k.toLowerCase())
            : [];
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
                    if (needle && lower.indexOf(needle) < 0) continue;
                    if (advanced
                        && keywords.some(k => lower.indexOf(k) < 0)) continue;
                    const at = m.created_at || '';
                    if (advanced && adv.after && at < adv.after) continue;
                    if (advanced && adv.before && at >= adv.before) continue;
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
        advanced,
        searched: !!q,
        domains: accessibleDomains,
        users: allUsers,
        results,
    }));
});

module.exports = {};

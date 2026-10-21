'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render, render403 } = require('../template');
const { buildNav, limitMessage } = require('./_helpers');
const { withSiteName } = require('./home');
const { checkDual } = require('../auth/privilege');

const PAGE_SIZE = 50;
// 扫描上限：防止无关键词时遍历整个库。命中后提示「还有更多」并可翻页
const MAX_RESULTS = 500;

function canAccessDomain(user, dn) {
    try {
        checkDual(user, auth.getDomainUser(dn, user), 'view_discussion');
        return true;
    } catch (e) {
        return false;
    }
}

// 转义正则元字符，关键词当普通文本匹配
function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);
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

route('GET', '/search', ({ res, user, query, req }) => {
    // 搜索会扫全库，单独限流
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
        // 关键词预编译成小写正则，避免每条消息都 toLowerCase + indexOf
        const keyRes = keywords.map(k => new RegExp(escapeRe(k), 'i'));

        for (const dn of searchTargets) {
            if (!canAccessDomain(user, dn)) continue;
            const discussions = discFilter
                ? [discFilter]
                : storage.listDiscussions(dn);
            for (const disc of discussions) {
                // 从最新分片往前找，够数就停
                const chunks = storage.listMessageChunks(dn, disc, true);
                for (const ch of chunks) {
                    for (const m of ch.arr) {
                        if (m.deleted || m.revoked) continue;
                        // 便宜的过滤先做：按人、按日期
                        if (userFilter && m.user_id !== userFilter) continue;
                        const at = m.created_at || '';
                        if (f.after && at < f.after) continue;
                        if (f.before && at >= f.before) continue;
                        if (!m.content) continue;
                        if (!keyRes.every(re => re.test(m.content))) continue;
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
            if (results.length >= MAX_RESULTS) break;
        }
        results.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }

    // 分页：总数取实际条数，截断时用 truncated 告知还有更多
    const total = results.length;
    const page = Math.max(1, Math.min(
        parseInt(query.page || '1', 10) || 1,
        Math.max(1, Math.ceil(total / PAGE_SIZE))));
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const pageItems = results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    render(res, 'search.html', withSiteName({
        current_user: user || {},
        nav: buildNav(user),
        q, domainFilter, discFilter, userFilter,
        searched: !!q,
        domains: accessibleDomains,
        users: allUsers,
        results: pageItems,
        total,
        page,
        pageCount,
        pageSize: PAGE_SIZE,
        truncated: total >= MAX_RESULTS,
    }));
});

module.exports = {};

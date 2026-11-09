'use strict';
const { route } = require('../../router');
const { render } = require('../../template');
const { buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { requireSystemAdmin } = require('./_helpers');
const auditLog = require('../../audit-log');
function parseType(raw) {
    const type = String(raw || 'all');
    return ['all', 'audit', 'security'].includes(type) ? type : 'all';
}
function parsePage(raw) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return 1;
    return Math.min(auditLog.MAX_PAGE, n);
}
const CHAIN_ERRORS = {
    hash: '内容哈希不匹配',
    gap: '序号缺失或重复',
    link: '前向哈希不匹配',
    checkpoint: '检查点之后缺少日志',
    checkpoint_hash: '检查点哈希不匹配',
};
function chainView() {
    const result = auditLog.verifyChain();
    return Object.assign({}, result, {
        head_short: result.head ? result.head.slice(0, 16) : '无',
        errors: result.errors.slice(0, 5).map(e => Object.assign({}, e, {
            label: CHAIN_ERRORS[e.code] || e.code,
        })),
    });
}
route('GET', '/manage/audit', ({ res, user, query }) => {
    if (!requireSystemAdmin(user, res, 'audit')) return;
    const type = parseType(query.type);
    const page = parsePage(query.page);
    const found = auditLog.events({
        kind: type,
        limit: auditLog.PAGE_SIZE + 1,
        offset: (page - 1) * auditLog.PAGE_SIZE,
    });
    const items = found.slice(0, auditLog.PAGE_SIZE);
    render(res, 'manage_audit.html', withSiteName({
        current_user: user, nav: buildNav(user), items, type, page,
        chain: chainView(),
        has_prev: page > 1,
        has_next: found.length > auditLog.PAGE_SIZE && page < auditLog.MAX_PAGE,
    }));
}, { auth: true });
route('GET', '/manage/audit/export', ({ res, user, query }) => {
    if (!requireSystemAdmin(user, res, 'audit')) return;
    const type = parseType(query.type);
    const items = auditLog.events({ kind: type, limit: auditLog.MAX_EXPORT });
    const date = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-${type}-${date}.log"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(items.join('\n') + (items.length ? '\n' : ''));
}, { auth: true });

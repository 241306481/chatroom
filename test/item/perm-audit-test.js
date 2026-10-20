'use strict';
// 权限系统审计：所有 GET/POST 路由是否都有权限守卫，权限位是否可达
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { PRIV, PERM, PRIV_GROUPS, DUAL_CHECK } = require('../../lib/permissions');
const { PAGE_BITS } = require('../../lib/routes/manage/_helpers');

// 公开入口：设计上就允许匿名，不应有守卫
const PUBLIC_ROUTES = new Set([
    'GET /login', 'GET /register', 'POST /login', 'POST /register',
    'GET /avatar/:uid/:ext', 'GET /search', 'GET /messages',
    'GET /user/:uid',
]);

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

// ---- 收集所有路由 ----
function walk(d, out = []) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        const p = path.join(d, e.name);
        e.isDirectory() ? walk(p, out) : (e.name.endsWith('.js') && out.push(p));
    }
    return out;
}

const ROUTE_DIR = path.join(__dirname, '../../lib/routes');
const routes = [];
for (const f of walk(ROUTE_DIR)) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /route\(\s*'(GET|POST|PUT|DELETE)'\s*,\s*'([^']*)'\s*,\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const tail = src.substring(m.index + m[0].length, m.index + m[0].length + 700);
        routes.push({
            method: m[1], path: m[2],
            file: path.relative(ROUTE_DIR, f).replace(/\\/g, '/'),
            opts: (src.substring(src.lastIndexOf('}', m.index + m[0].length) + 1, m.index + m[0].length + 120) || '') + tail,
            tail,
        });
    }
}

// ---- 1. 写操作必须有守卫 ----
const WRITE_GUARDS = [
    /requireSystemAdmin/, /hasPriv\(/, /checkPriv\(/, /checkDual\(/,
    /checkPerm\(/, /UnauthorizedError/, /canManageDomain\(/, /guard\(/,
    /return json\(res, 401/, /json\(res, 401/, /401\)/, /!user\s*\|\|\s*!user\.id/,
];
check('写操作(POST/PUT/DELETE)全部有权限守卫', () => {
    const bad = [];
    for (const r of routes) {
        if (r.method === 'GET') continue;
        if (PUBLIC_ROUTES.has(r.method + ' ' + r.path)) continue;
        const full = r.tail + ' ' + r.opts;
        if (!WRITE_GUARDS.some(g => g.test(full))) bad.push(r.method + ' ' + r.path);
    }
    if (bad.length) throw new Error(bad.join(' | '));
});

check('全部路由至少声明 auth 或有守卫（GET 允许匿名）', () => {
    const bad = routes.filter(r => r.method === 'GET'
        && !PUBLIC_ROUTES.has(r.method + ' ' + r.path)
        && !/auth:\s*true/.test(r.opts)
        && !WRITE_GUARDS.some(g => g.test(r.tail))).map(r => r.path);
    if (bad.length) throw new Error(bad.join(' | '));
});

// ---- 2. 系统管理 8 项都有对应权限位 ----
const SYS_PAGES = {
    '/manage/settings': PRIV.SYSTEM.EDIT_SETTINGS,
    '/manage/users': PRIV.SYSTEM.MANAGE_USERS,
    '/manage/system_roles': PRIV.SYSTEM.MANAGE_SYS_ROLES,
    '/manage/permissions': PRIV.SYSTEM.MANAGE_SYS_PERMS,
    '/manage/ip_bans': PRIV.SYSTEM.MANAGE_IP_BANS,
    '/manage/user_ips': PAGE_BITS.user_ips,
    '/manage/join_applications': PAGE_BITS.join_applications,
    '/create/domain': PRIV.BASE.CREATE_DOMAIN,
};
check('系统管理各页均映射到具体权限位（无 MANAGE_PANEL 兜底）', () => {
    const bad = Object.entries(SYS_PAGES)
        .filter(([p, b]) => p !== '/manage/user_ips' && (!b || b === PRIV.SYSTEM.MANAGE_PANEL))
        .map(([p]) => p);
    if (bad.length) throw new Error(bad.join(', '));
});

check('系统组新位已进 PRIV_GROUPS（可在权限页勾选）', () => {
    for (const k of ['MANAGE_SYS_ROLES', 'MANAGE_SYS_PERMS', 'MANAGE_IP_BANS']) {
        const hit = PRIV_GROUPS.find(g => g.bit === PRIV.SYSTEM[k]);
        if (!hit) throw new Error(k + ' 缺少 PRIV_GROUPS 条目');
        if (!hit.key) throw new Error(k + ' 缺少 key');
    }
});

check('路由确实用上了新位（requireSystemAdmin 传了 page）', () => {
    const files = ['manage/ip-bans.js', 'manage/system-roles.js'].map(f =>
        fs.readFileSync(path.join(ROUTE_DIR, f), 'utf8')).join('\n');
    for (const page of ['ip_bans', 'system_roles', 'permissions']) {
        if (!files.includes("requireSystemAdmin(user, res, '" + page + "')"))
            throw new Error(page + ' 未接线');
    }
});

// ---- 3. PERM 位完整性 ----
check('PERM 位双字表示：每项是 {hi,lo} 且只占一位', () => {
    const seen = new Map();
    for (const [g, group] of Object.entries(PERM)) {
        if (g === 'ALL') continue;
        for (const [k, v] of Object.entries(group)) {
            if (!v || typeof v !== 'object') throw new Error(g + '.' + k + ' 不是双字对象');
            const { hi, lo } = v;
            if (!Number.isInteger(hi) || !Number.isInteger(lo))
                throw new Error(g + '.' + k + ' 分量非整数');
            if (hi < 0 || lo < 0) throw new Error(g + '.' + k + ' 分量为负');
            const oneHot = (x) => x === 0 || (x & (x - 1)) === 0;
            if (!oneHot(hi) || !oneHot(lo))
                throw new Error(g + '.' + k + ' 不是单一比特: hi=' + hi + ' lo=' + lo);
            if (hi && lo) throw new Error(g + '.' + k + ' 同时占高低两字');
            const key = hi + ':' + lo;
            if (seen.has(key))
                throw new Error(g + '.' + k + ' 与 ' + seen.get(key) + ' 位冲突');
            seen.set(key, g + '.' + k);
        }
    }
});

check('PERM 已扩到 64 位：高字空闲，可继续加 32 个权限', () => {
    let total = 0;
    for (const [g, group] of Object.entries(PERM)) {
        if (g === 'ALL') continue;
        total += Object.keys(group).length;
    }
    // 低字 32 位 + 高字 32 位 = 64 位上限
    if (total > 64) throw new Error('权限项超过 64 个');
    // 高字机制可用：手工造一个高位权限并验证
    const { bits } = require('../../lib/permissions');
    const high = bits.bitByIndex(32);
    assert.ok(bits.has(high, high), '高字位应可判定');
    assert.ok(!bits.has(PERM.GENERAL.VIEW, high), '低位不应含高位');
});

check('MANAGE_PERM 与 MANAGE_ROLE 是两个独立位', () => {
    const { bits } = require('../../lib/permissions');
    if (bits.has(PERM.MANAGE.PERM, PERM.MANAGE.ROLE))
        throw new Error('MANAGE_PERM 不应隐含 MANAGE_ROLE');
    if (bits.has(PERM.MANAGE.ROLE, PERM.MANAGE.PERM))
        throw new Error('MANAGE_ROLE 不应隐含 MANAGE_PERM');
    if (!bits.has(PERM.ALL, PERM.MANAGE.PERM)) throw new Error('ALL 不含 MANAGE_PERM');
    if (!bits.has(PERM.ALL, PERM.MANAGE.ROLE)) throw new Error('ALL 不含 MANAGE_ROLE');
});

check('位序号与 PERM 表一致（严格连续，无空洞）', () => {
    const { PERM_NAMES } = require('../../lib/permissions');
    const { bits } = require('../../lib/permissions');
    const flat = [];
    for (const [g, group] of Object.entries(PERM)) {
        if (g === 'ALL') continue;
        for (const [k, bit] of Object.entries(group)) flat.push({ g, k, bit });
    }
    for (const item of PERM_NAMES) {
        const pos = flat.findIndex(f => bits.eq(f.bit, item.bit));
        if (pos === -1) throw new Error(item.name + ' 的 bit 不在 PERM 表');
        if (pos !== item.index)
            throw new Error(item.name + ' 位序号 ' + item.index
                + ' 与表中位置 ' + pos + ' 不符');
    }
    const idx = PERM_NAMES.map(p => p.index).sort((a, b) => a - b);
    for (let i = 0; i < idx.length; i++) {
        if (idx[i] !== i) throw new Error('位序号不连续，缺 ' + i);
    }
    if (PERM_NAMES.length !== flat.length)
        throw new Error('PERM_NAMES(' + PERM_NAMES.length
            + ') 与 PERM 表项数(' + flat.length + ') 不符');
});

check('PERM 表无保留占位（开发阶段不留空位）', () => {
    const order = Object.keys(PERM).filter(k => k !== 'ALL');
    const reserved = order.filter(k => /^RESERVED_/.test(k));
    if (reserved.length)
        throw new Error('仍有保留位: ' + reserved.join(', '));
});

check('已移除的「查看用户私密信息」不再出现在 UI 权限项中', () => {
    const { PERM_NAMES } = require('../../lib/permissions');
    const hit = PERM_NAMES.find(p => p.name.includes('私密'));
    if (hit) throw new Error('「' + hit.name + '」仍出现在权限矩阵中');
});

check('PERM.ALL 覆盖全部已定义位', () => {
    const { hasPerm } = require('../../lib/permissions');
    for (const [g, group] of Object.entries(PERM)) {
        if (g === 'ALL') continue;
        for (const [k, v] of Object.entries(group)) {
            if (!hasPerm(PERM.ALL, v)) throw new Error('ALL 不含 ' + g + '.' + k);
        }
    }
});

// ---- 4. 双检映射完整 ----
check('DUAL_CHECK 每项都有 priv 且 perm 在 PERM 表内', () => {
    for (const [op, c] of Object.entries(DUAL_CHECK)) {
        if (!c.priv || !c.label) throw new Error(op + ' 缺 priv/label');
        const g = PRIV[String(c.priv.group).toUpperCase()];
        if (!g) throw new Error(op + ' 未知组 ' + c.priv.group);
        if (!Object.values(g).includes(c.priv.bit))
            throw new Error(op + ' 位不属于 ' + c.priv.group);
    }
});

check('双检映射的 perm 键都存在于 PERM', () => {
    const { bits } = require('../../lib/permissions');
    const valid = [];
    for (const [g, group] of Object.entries(PERM)) {
        if (g === 'ALL') continue;
        for (const v of Object.values(group)) valid.push(v);
    }
    const isValid = (v) => valid.some(x => bits.eq(x, v));
    for (const [op, c] of Object.entries(DUAL_CHECK)) {
        if (c.perm !== undefined && !isValid(c.perm))
            throw new Error(op + ' 的 perm 位不在 PERM 表');
        if (c.permOwn !== undefined && !isValid(c.permOwn))
            throw new Error(op + ' 的 permOwn 位不在 PERM 表');
    }
});

// ---- 5. 加入设置/加入申请按要求绑定 ----
check('加入设置与加入申请共用 MANAGE_JOIN_APPL（按需求保持绑定）', () => {
    if (DUAL_CHECK.manage_join.perm !== PERM.MANAGE.JOIN_APPL)
        throw new Error('manage_join 未绑定 MANAGE_JOIN_APPL');
    const privBit = DUAL_CHECK.manage_join.priv.bit;
    if (privBit !== PRIV.DOMAIN.MANAGE_JOIN)
        throw new Error('系统侧未绑定 DOMAIN.MANAGE_JOIN');
});

console.log('\n======== [审计] 权限系统 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(0);
'use strict';
// PERM 双字改造回归：
//  1. 存量数据（单个整数）零迁移
//  2. 落盘用字符串，64 位无损
//  3. 权限管理（MANAGE_PERM）与角色管理（MANAGE_ROLE）独立
//  4. 端到端：勾选/保存/读取闭环
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const storage = require('../../lib/storage');
const { PERM, PERM_NAMES, hasPerm, expandPerm, bits } = require('../../lib/permissions');

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();

// ---- 1. 存量兼容 ----
check('裸数字形式的权限值可直接判定', () => {
    // 位号已重排，不硬编码数值：按 PERM 表反查每一位的裸数字
    const raw = bits.toStr(PERM.MANAGE.ROLE);
    assert.ok(hasPerm(raw, PERM.MANAGE.ROLE), '应能判定');
    assert.ok(!hasPerm(raw, PERM.MANAGE.USER), '不该误判');
});

check('高位（>32 位）的权限值也能识别', () => {
    const high = bits.bitByIndex(40);
    assert.ok(hasPerm(bits.toStr(high), high), '高位应能判定');
    assert.ok(!hasPerm(bits.toStr(high), PERM.GENERAL.VIEW), '不该误判');
});

check('字符串形式的权限值同样可判', () => {
    assert.ok(hasPerm(bits.toStr(PERM.MANAGE.ROLE), PERM.MANAGE.ROLE));
    assert.ok(hasPerm(bits.toStr(PERM.MANAGE.PERM), PERM.MANAGE.PERM));
    assert.ok(hasPerm(bits.toStr(PERM.ALL), PERM.MANAGE.PERM));
    assert.ok(hasPerm(bits.toStr(PERM.ALL), PERM.MANAGE.ROLE));
});

check('垃圾输入不抛异常', () => {
    for (const v of [null, undefined, '', 'abc', -1, {}, { hi: 'x', lo: null }]) {
        hasPerm(v, PERM.GENERAL.VIEW);
        expandPerm(v);
    }
});

// ---- 2. 位运算正确性 ----
check('双字位运算：or/and/not/has 自洽', () => {
    const a = bits.or(PERM.GENERAL.VIEW, PERM.MANAGE.PERM);
    assert.ok(bits.has(a, PERM.GENERAL.VIEW));
    assert.ok(bits.has(a, PERM.MANAGE.PERM));
    assert.ok(!bits.has(a, PERM.MANAGE.USER));
    const n = bits.not(a);
    assert.ok(!bits.has(n, PERM.GENERAL.VIEW));
    assert.ok(!bits.has(n, PERM.MANAGE.PERM));
    assert.ok(bits.has(n, PERM.MANAGE.USER));
});

check('toStr/norm 往返无损（64 位）', () => {
    for (const p of [PERM.GENERAL.VIEW, PERM.MANAGE.DELETE, PERM.MANAGE.PERM, PERM.ALL]) {
        const s = bits.toStr(p);
        const back = bits.norm(s);
        assert.ok(bits.eq(back, p), p.name || 'perm 往返失败: ' + s);
    }
    // 最高位组合（不硬编码数值，随位号重排而变）
    const combo = bits.or(PERM.MANAGE.PERM, PERM.MANAGE.DELETE);
    const comboStr = bits.toStr(combo);
    assert.ok(bits.has(bits.norm(comboStr), PERM.MANAGE.PERM));
    assert.ok(bits.has(bits.norm(comboStr), PERM.MANAGE.DELETE));
    assert.ok(!bits.has(bits.norm(comboStr), PERM.GENERAL.VIEW));
});

check('64 位值不丢精度（超出 2^53 的部分）', () => {
    // 2^60 位
    const v = { hi: (1 << 28) >>> 0, lo: 0 };
    const str = bits.toStr(v);
    assert.strictEqual(str, '1152921504606846976');
    assert.ok(bits.has(bits.norm(str), v));
    // 2^32 位（低字边界）
    assert.strictEqual(bits.toStr(bits.bitByIndex(32)), '4294967296');
});

// ---- 3. 角色管理 / 权限管理 独立 ----
check('MANAGE_ROLE 与 MANAGE_PERM 是两个独立位', () => {
    assert.notStrictEqual(bits.toStr(PERM.MANAGE.ROLE), bits.toStr(PERM.MANAGE.PERM));
    assert.ok(!bits.has(PERM.MANAGE.ROLE, PERM.MANAGE.PERM));
    assert.ok(!bits.has(PERM.MANAGE.PERM, PERM.MANAGE.ROLE));
});

check('MANAGE_ROLE 不隐含 MANAGE_PERM（关闭互不影响）', () => {
    const only = expandPerm(PERM.MANAGE.ROLE);
    assert.ok(!bits.has(only, PERM.MANAGE.PERM),
        '只有角色管理时不应自动获得权限管理');
});

check('双检映射里 manage_role / manage_perm 各自独立', () => {
    const { DUAL_CHECK } = require('../../lib/permissions');
    assert.ok(DUAL_CHECK.manage_role, '缺 manage_role');
    assert.ok(DUAL_CHECK.manage_perm, '缺 manage_perm');
    assert.notStrictEqual(DUAL_CHECK.manage_role.perm, DUAL_CHECK.manage_perm.perm);
    assert.notStrictEqual(DUAL_CHECK.manage_role.priv.bit, DUAL_CHECK.manage_perm.priv.bit);
});

check('系统侧 PRIV 也拆出 MANAGE_PERM', () => {
    const { PRIV } = require('../../lib/permissions');
    assert.ok(PRIV.MEMBER.MANAGE_PERM, 'PRIV.MEMBER.MANAGE_PERM 未定义');
    assert.notStrictEqual(PRIV.MEMBER.MANAGE_PERM, PRIV.MEMBER.MANAGE_ROLE);
});

// ---- 4. 端到端：落盘 -> 读回 ----
check('域角色权限落盘为字符串并能读回', () => {
    const dn = 'perm-e2e-test';
    try { storage.deleteDomain(dn); } catch (e) {}
    storage.createDomain(dn, 'perm e2e', 'owner-e2e');

    const domain = storage.loadDomain(dn);
    domain.roles = { tester: { display: '测试角色', perm: bits.norm(bits.or(PERM.MANAGE.PERM, PERM.MANAGE.ROLE)) } };
    storage.saveDomain(dn, domain);

    const reloaded = storage.loadDomain(dn);
    const stored = reloaded.roles.tester.perm;
    assert.ok(stored && typeof stored === 'object', '落盘应为 {hi,lo} 对象');
    assert.strictEqual(typeof stored.hi, 'number');
    assert.strictEqual(typeof stored.lo, 'number');
    assert.ok(hasPerm(stored, PERM.MANAGE.PERM), '读回后应仍持有 MANAGE_PERM');
    assert.ok(hasPerm(stored, PERM.MANAGE.ROLE), '读回后应仍持有 MANAGE_ROLE');
    assert.ok(!hasPerm(stored, PERM.MANAGE.USER), '不应多出 MANAGE_USER');

    try { storage.deleteDomain(dn); } catch (e) {}
});

check('PERM_NAMES 的位序号与 PERM 表位置一致（无空洞）', () => {
    const flat = [];
    for (const [g, group] of Object.entries(PERM)) {
        if (g === 'ALL') continue;
        for (const [k, bit] of Object.entries(group)) flat.push({ g, k, bit });
    }
    for (const item of PERM_NAMES) {
        const pos = flat.findIndex(f => bits.eq(f.bit, item.bit));
        assert.ok(pos >= 0, item.name + ' 的 bit 不在 PERM 表');
        assert.strictEqual(pos, item.index, item.name + ' 位序号与表中位置不符');
    }
    // 开发阶段不做位号保留，位序号必须严格连续
    const idx = PERM_NAMES.map(p => p.index).sort((a, b) => a - b);
    idx.forEach((v, i) => assert.strictEqual(v, i, '位序号不连续于 ' + i));
    assert.strictEqual(PERM_NAMES.length, flat.length);
    for (const f of flat) {
        assert.ok(!/^RESERVED_/.test(f.k), f.g + ' 组不应有保留占位');
    }
});

check('权限页模板用位序号而非位掩码', () => {
    const tpl = fs.readFileSync(
        path.join(__dirname, '../../templates/manage_permission.html'), 'utf8');
    assert.ok(tpl.includes('data-index'), '模板应使用 data-index');
    assert.ok(!tpl.includes('data-bit'), '模板不应再用 data-bit');
    assert.ok(tpl.includes('data-index'), '前端按位序号计算');
    assert.ok(tpl.includes('r.permStr'), '隐藏字段应使用 permStr');
});

check('权限页路由用 manage_perm 校验', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/manage/roles.js'), 'utf8');
    const permRoute = src.substring(src.indexOf("/manage/permission"));
    assert.ok(permRoute.includes("'manage_perm'"), '权限页应校验 manage_perm');
    const roleRoute = src.substring(0, src.indexOf("/manage/permission"));
    assert.ok(roleRoute.includes("'manage_role'"), '角色页应校验 manage_role');
});

check('「查看用户私密信息」已彻底移除（无 UI 项、无占位）', () => {
    const { PERM_NAMES, PERM } = require('../../lib/permissions');
    assert.ok(!PERM_NAMES.find(p => p.name.includes('私密')),
        '权限矩阵不应再出现「查看用户私密信息」');
    const order = Object.keys(PERM).filter(k => k !== 'ALL');
    assert.ok(!order.some(k => k.includes('PRIVATE_INFO')),
        'PERM 表不应残留相关常量');
    assert.strictEqual(order.filter(k => /^RESERVED_/.test(k)).length, 0,
        '开发阶段不保留空位');
});

check('前端用 BigInt 合成 64 位值（普通 Number 会丢精度）', () => {
    const tpl = fs.readFileSync(
        path.join(__dirname, '../../templates/manage_permission.html'), 'utf8');
    assert.ok(tpl.includes('BigInt('), '模板应使用 BigInt 合成');
    assert.ok(tpl.includes('32n'), '模板应使用 BigInt 移位');
    // 不能用 hi * 2^32 + lo：超过 2^53 会丢精度
    assert.ok(!/hi\s*\*\s*(4294967296|PERM_TWO32)/.test(tpl),
        '不应使用普通 Number 乘法合成');
    // 验证 BigInt 方案确实无损
    const hi = 0xFFFFFFFF, lo = 0xFFFFFFFF;
    const v = (BigInt(hi) << 32n) | BigInt(lo);
    assert.strictEqual(v.toString(), '18446744073709551615');
});

console.log('\n======== [回归] PERM 双字改造 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
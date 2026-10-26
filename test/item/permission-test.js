const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const storage = require('../../lib/storage');
const auth = require('../../lib/auth');
const { PRIV, hasPriv } = require('../../lib/permissions');
const { checkDual } = require('../../lib/auth/privilege');
const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };
storage.ensureDirs(); storage.ensureSystemDomain(); storage.ensureSystemUser();
const ownerId = storage.createUser('ownr', 'pw123456');
storage.createUser('fill1', 'pw123456');
const adminId = storage.createUser('domadm', 'pw123456');
storage.createDomain('ptest', 'PTest', ownerId);
auth.grantRole('ptest', adminId, 'root');
check('域管理员的 du.is_privileged 为 true', () => {
    const u = storage.loadUser(adminId);
    assert.strictEqual(auth.getDomainUser('ptest', u).is_privileged, true);
});
check('关闭前：域管理员可以置顶', () => {
    const u = storage.loadUser(adminId);
    checkDual(u, auth.getDomainUser('ptest', u), 'pin_message');
});
check('关掉 member 的 message.pin 后该位确实为 0', () => {
    const sysRoles = require('../../lib/storage/system-roles');
    const roles = sysRoles.loadRoles();
    const p = { ...roles.member.privs };
    p.message = p.message & ~PRIV.MESSAGE.PIN;
    sysRoles.saveRolePrivs('member', p);
    sysRoles.invalidateCache();
    assert.strictEqual(hasPriv(storage.loadUser(adminId), 'message', PRIV.MESSAGE.PIN), false);
});
check('★ 域管理员也不能置顶（全局关闭开关必须生效）', () => {
    const u = storage.loadUser(adminId);
    const du = auth.getDomainUser('ptest', u);
    let denied = false;
    try { checkDual(u, du, 'pin_message'); } catch (e) { denied = true; }
    assert.ok(denied, '域管理员仍然可以置顶 —— 全局 kill-switch 对特权用户失效');
});
check('★ WebSocket 侧行为一致（不得比 HTTP 更宽松）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/websocket/discuss-guard.js'), 'utf8');
    assert.ok(!/PRIV_EXEMPT_GROUPS/.test(src), 'WS 侧不应再有特权豁免');
    assert.ok(!/skipPriv/.test(src), 'WS 侧不应再有 skipPriv 豁免分支');
    const http = fs.readFileSync(path.join(ROOT, 'lib/auth/privilege.js'), 'utf8');
    assert.ok(!/PRIV_EXEMPT_GROUPS/.test(http), 'HTTP 侧不应再有特权豁免');
    assert.ok(!/skipPriv/.test(http), 'HTTP 侧不应再有 skipPriv 豁免分支');
    const main = fs.readFileSync(path.join(ROOT, 'lib/websocket/discuss.js'), 'utf8');
    assert.ok(/require\('\.\/discuss-guard'\)/.test(main), 'discuss.js 未引用 discuss-guard');
    assert.ok(!/PRIV_EXEMPT_GROUPS/.test(main), 'discuss.js 仍留有本地副本');
});
    check('域设置默认开放：成员角色的 domain 位已给默认值', () => {
    const u = storage.loadUser(adminId);
    assert.strictEqual(hasPriv(u, 'domain', PRIV.DOMAIN.EDIT), true,
        '前提不成立：member 角色的 domain 位应默认开放');
    const du = auth.getDomainUser('ptest', u);
    assert.strictEqual(du.role, 'root');
    checkDual(u, du, 'edit_domain');
});
check('域设置不再豁免：关掉权限位后域所有者同样被拒', () => {
    const u = storage.loadUser(adminId);
    const saved = u.privs.domain;
    u.privs.domain = 0;
    try {
        let denied = false;
        try { checkDual(u, auth.getDomainUser('ptest', u), 'edit_domain'); }
        catch (e) { denied = true; }
        assert.ok(denied, '域所有者在关闭域设置权限后仍能编辑');
    } finally {
        u.privs.domain = saved;
    }
});
check('关闭 message 位后不会被域设置的改动放宽', () => {
    const u = storage.loadUser(adminId);
    let denied = false;
    try { checkDual(u, auth.getDomainUser('ptest', u), 'pin_message'); } catch (e) { denied = true; }
    assert.ok(denied, '豁免范围错误地扩大到了非 domain 组');
});
check('域管理员仍保留域设置能力（edit_domain / manage_join）', () => {
    const u = storage.loadUser(adminId);
    const du = auth.getDomainUser('ptest', u);
    checkDual(u, du, 'edit_domain');
    checkDual(u, du, 'manage_join');
});
check('普通成员置顶仍被拒绝（未被本次改动放宽）', () => {
    const otherId = storage.createUser('plainp', 'pw123456');
    auth.grantRole('ptest', otherId, 'default');
    const u = storage.loadUser(otherId);
    let denied = false;
    try { checkDual(u, auth.getDomainUser('ptest', u), 'pin_message'); } catch (e) { denied = true; }
    assert.ok(denied);
});
check('超管不受影响（member 位关掉后仍能置顶）', () => {
    const su = storage.loadUser(ownerId);
    assert.strictEqual(hasPriv(su, 'message', PRIV.MESSAGE.PIN), true);
    checkDual(su, auth.getDomainUser('ptest', su), 'pin_message');
});
console.log('\n======== [回归 2] 权限：置顶 kill-switch ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

// [回归 2] 权限：关掉 member 的「置顶」后，域管理员也不得置顶。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DATA = 'D:/chatroom/data';
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const storage = require('D:/chatroom/lib/storage');
const auth = require('D:/chatroom/lib/auth');
const { PRIV, hasPriv } = require('D:/chatroom/lib/permissions');
const { checkDual } = require('D:/chatroom/lib/auth/privilege');

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

storage.ensureDirs(); storage.ensureSystemDomain(); storage.ensureSystemUser();
const ownerId = storage.createUser('ownr', 'pw123456');
storage.createUser('fill1', 'pw123456');
const adminId = storage.createUser('domadm', 'pw123456');   // system role = member
storage.createDomain('ptest', 'PTest', ownerId);
auth.grantRole('ptest', adminId, 'root');                   // 域内管理员

check('域管理员的 du.is_privileged 为 true', () => {
    const u = storage.loadUser(adminId);
    assert.strictEqual(auth.getDomainUser('ptest', u).is_privileged, true);
});
check('关闭前：域管理员可以置顶', () => {
    const u = storage.loadUser(adminId);
    checkDual(u, auth.getDomainUser('ptest', u), 'pin_message');   // 不应抛
});
check('关掉 member 的 message.pin 后该位确实为 0', () => {
    const sysRoles = require('D:/chatroom/lib/storage/system-roles');
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
    // WS 侧的闸门已抽到 discuss-guard.js（discuss.js 只保留消息/连接处理）
    const src = fs.readFileSync('D:/chatroom/lib/websocket/discuss-guard.js', 'utf8');
    assert.ok(/PRIV_EXEMPT_GROUPS\.has\(conf\.priv && conf\.priv\.group\)/.test(src),
        'WS 侧仍未按组收窄 skipPriv');
    // 且 discuss.js 必须真正用上它，不能留一份死副本
    const main = fs.readFileSync('D:/chatroom/lib/websocket/discuss.js', 'utf8');
    assert.ok(/require\('\.\/discuss-guard'\)/.test(main), 'discuss.js 未引用 discuss-guard');
    assert.ok(!/PRIV_EXEMPT_GROUPS\.has/.test(main), 'discuss.js 仍留有本地副本');
});
check('域设置组仍然豁免（系统角色 member 的 privs.domain=0，域所有者仍能管自己的域）', () => {
    const u = storage.loadUser(adminId);          // 系统角色 member → privs.domain 应为 0
    assert.strictEqual(hasPriv(u, 'domain', PRIV.DOMAIN.EDIT), false,
        '前提不成立：member 角色的 domain 位本应为 0');
    const du = auth.getDomainUser('ptest', u);
    assert.strictEqual(du.role, 'root');
    checkDual(u, du, 'edit_domain');   // 不应抛 —— 豁免生效
});
check('域设置组豁免后，被关闭的 message 位不受影响', () => {
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
    const su = storage.loadUser(ownerId);          // 首个用户 = system root
    assert.strictEqual(hasPriv(su, 'message', PRIV.MESSAGE.PIN), true);
    checkDual(su, auth.getDomainUser('ptest', su), 'pin_message');   // 不应抛
});

console.log('\n======== [回归 2] 权限：置顶 kill-switch ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PROJ = path.join(__dirname, '..', '..');
const DATA = path.join(PROJ, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const storage = require('../../lib/storage');
const auth = require('../../lib/auth');
const { checkDual } = require('../../lib/auth/privilege');
const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };
storage.ensureDirs(); storage.ensureSystemDomain(); storage.ensureSystemUser();
const rootId = storage.createUser('rootu', 'pw123456');
const sysId = storage.createUser('sysad', 'pw123456');
const ownerId = storage.createUser('ownu', 'pw123456');
const memberId = storage.createUser('memb', 'pw123456');
auth.setSystemRole(sysId, 'admin');
storage.createDomain('gdom', 'G', ownerId);
auth.grantRole('gdom', ownerId, 'owner');
auth.grantRole('gdom', memberId, 'default');
const OWNER = storage.loadUser(ownerId);
const MEMBER = storage.loadUser(memberId);
const SYSAD = storage.loadUser(sysId);
const ROOT = storage.loadUser(rootId);
check('域所有者仍可执行全部域级操作', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['edit_domain', 'manage_join', 'transfer_domain', 'delete_domain']) {
        checkDual(OWNER, du, op);
    }
});
check('域所有者仍可管理成员（禁言/踢出/角色）', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['mute_member', 'kick_member', 'manage_user', 'manage_role']) {
        checkDual(OWNER, du, op);
    }
});
check('域所有者仍可发消息/表情/置顶/撤回', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['send_message', 'add_reaction', 'pin_message']) {
        checkDual(OWNER, du, op);
    }
    checkDual(OWNER, du, 'revoke_message', true);
    checkDual(OWNER, du, 'delete_message', false);
});
check('域所有者仍可查看讨论与文件', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['view_discussion', 'create_discussion', 'view_file', 'upload_file']) {
        checkDual(OWNER, du, op);
    }
});
check('系统管理员（MANAGE_PANEL）不受影响', () => {
    const du = auth.getDomainUser('gdom', SYSAD);
    assert.strictEqual(du.is_privileged, true);
    for (const op of ['send_message', 'pin_message', 'kick_member', 'edit_domain']) {
        checkDual(SYSAD, du, op);
    }
});
check('超管不受影响', () => {
    const du = auth.getDomainUser('gdom', ROOT);
    for (const op of ['send_message', 'pin_message', 'kick_member', 'edit_domain', 'delete_domain']) {
        checkDual(ROOT, du, op);
    }
});
check('普通成员的基础能力未被放宽', () => {
    const du = auth.getDomainUser('gdom', MEMBER);
    checkDual(MEMBER, du, 'send_message');
    let denied = false;
    try { checkDual(MEMBER, du, 'edit_domain'); } catch (e) { denied = true; }
    assert.ok(denied, '普通成员通过了 edit_domain');
});
check('r1: 昵称索引不受 Object.prototype 昵称影响', () => {
    const users = require('../../lib/storage/users');
    for (const n of ['toString', '__proto__', 'constructor']) {
        assert.strictEqual(users.findUserByNickname(n), null);
    }
});
check('assertSafeName 拒绝 Windows 非法名', () => {
    const { assertSafeName } = require('../../lib/storage/paths');
    for (const n of ['a:b', 'a?b', 'a*b', 'a"b', 'a<b', 'a>b', 'a|b',
        'CON', 'con.txt', 'NUL', 'COM1', 'LPT9', 'foo.', 'foo ', 'a\u0001b']) {
        assert.throws(() => assertSafeName(n), /非法/, '放行了危险名称: ' + JSON.stringify(n));
    }
    assert.strictEqual(assertSafeName('normal-name_1'), 'normal-name_1');
});
check('listAllDomains 跳过异常目录名', () => {
    const bad = path.join(DATA, 'domains', 'x'.repeat(65));
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, 'config.json'), '{}');
    const list = storage.listAllDomains();
    assert.ok(list.includes('gdom'), '正常域被遗漏');
    assert.ok(!list.includes('x'.repeat(65)), '异常目录名未跳过');
});
check('r1: 文件 ID 拒绝 __proto__', () => {
    const uf = require('../../lib/storage/user-files');
    assert.throws(() => uf.setUserFileVisibility(memberId, '__proto__', 'public'));
    assert.strictEqual({}.visibility, undefined);
});
check('r1: safeFileId 为唯一实现，用户/域文件共用', () => {
    const { safeFileId } = require('../../lib/storage/fs-utils');
    for (const id of ['__proto__', 'constructor', 'prototype', '..', '.', 'a/b', 'a\\b', 'a\0b', '',
        'a:b', 'a?b', 'a*b', 'CON', 'con.txt', 'NUL', 'COM1', 'LPT9', 'foo.', 'foo ']) {
        assert.strictEqual(safeFileId(id), null, '放行了危险 id: ' + JSON.stringify(id));
    }
    assert.strictEqual(safeFileId('abc123'), 'abc123');
});
check('r1: 文件 MIME 会清理换行和控制字符', () => {
    const { makeFileMeta, normalizeMime } = require('../../lib/storage/fs-utils');
    assert.strictEqual(normalizeMime('text/plain\r\nX-Evil: 1'), 'text/plain');
    assert.strictEqual(normalizeMime('\u0000'), 'application/octet-stream');
    const meta = makeFileMeta({
        id: 'mime-test', name: 'a.txt', mime: 'text/plain\r\nX-Evil: 1',
        buffer: Buffer.from('x'), owner: '1',
    });
    assert.strictEqual(meta.mime, 'text/plain');
});
check('r1: 损坏的密码哈希不会让登录校验抛错', () => {
    const { verifyPassword } = require('../../lib/storage/fs-utils');
    const salt = 'a'.repeat(32);
    assert.strictEqual(
        verifyPassword('x', 'scrypt:' + salt + ':' + 'z'.repeat(128)), false);
    assert.strictEqual(
        verifyPassword('x', 'scrypt:' + 'z'.repeat(32) + ':' + 'a'.repeat(128)), false);
});
check('r1: requireSystemAdmin 三态正确（抽到 manage/_helpers 后回归）', () => {
    const { requireSystemAdmin } = require('../../lib/routes/manage/_helpers');
    const { UnauthorizedError } = require('../../lib/auth/privilege');
    const stub = () => ({ headers: {}, writeHead() {}, end() {} });
    assert.strictEqual(requireSystemAdmin(ROOT, stub()), true, '超管被拒');
    assert.strictEqual(requireSystemAdmin(MEMBER, stub()), false, '普通成员未被拒');
    assert.throws(() => requireSystemAdmin(null, stub()), UnauthorizedError, '匿名未抛 401');
    assert.throws(() => requireSystemAdmin(undefined, stub()), UnauthorizedError);
});
check('formatSize 为唯一实现，控制台与网页共用同一函数', () => {
    const { formatSize } = require('../../lib/format');
    assert.strictEqual(require('../../lib/routes/_helpers').formatSize, formatSize);
    assert.strictEqual(require('../../lib/console/ui').formatSize, formatSize);
    assert.strictEqual(formatSize(1536), '1.5 KB');
    assert.strictEqual(formatSize(null), '—');
});
check('r2: 社交操作不会为不存在的 uid 建目录', () => {
    const social = require('../../lib/storage/social');
    assert.strictEqual(social.unfollow(memberId, 'ghost88'), false);
    assert.ok(!fs.readdirSync(path.join(DATA, 'users')).includes('ghost88'));
});
check('r6: 封禁时间校验统一且严格', () => {
    assert.strictEqual(auth.normalizeUntil('2099-99-99T99:99:99'), null);
    assert.strictEqual(auth.normalizeUntil('2024-02-30T12:00'), null);
    assert.strictEqual(auth.normalizeUntil('9999-12-31T23:59:59'), '9999-12-31T23:59:59Z');
});
check('登录限流：连续失败后被拦截，成功后清零', () => {
    const rl = require('../../lib/auth/rate-limit');
    for (let i = 0; i < 30; i++) rl.noteFailure('victim', '10.1.1.1');
    assert.ok(rl.checkLoginAllowed('victim', '10.1.1.1'), 'IP 维度未拦截');
    rl.noteSuccess('victim', '10.1.1.1');
    assert.strictEqual(rl.checkLoginAllowed('victim', '10.1.1.1'), null, '成功后未清零');
    assert.strictEqual(rl.checkLoginAllowed('other', '10.1.1.1'), null,
        '成功后该 IP 的其它账号仍被拦截');
});
check('登录限流：按 IP 维度独立计数', () => {
    const rl = require('../../lib/auth/rate-limit');
    for (let i = 0; i < 30; i++) rl.noteFailure('u' + i, '10.2.2.2');
    assert.ok(rl.checkLoginAllowed('fresh', '10.2.2.2'), 'IP 维度阈值未生效');
    assert.strictEqual(rl.checkLoginAllowed('fresh', '10.3.3.3'), null, '误伤其它 IP');
});
check('依赖无已知漏洞（npm audit 报告）', () => {
    const r = require('child_process').spawnSync('npm.cmd',
        ['audit', '--registry=https://registry.npmjs.org'],
        { cwd: PROJ, encoding: 'utf8', timeout: 180000, shell: true });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(/found 0 vulnerabilities/.test(out),
        'npm audit 未通过:\n' + out.slice(-400));
});
console.log('\n======== [回归] 特权能力与历史不变量 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

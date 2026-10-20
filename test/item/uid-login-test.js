'use strict';
// UID 登录：账号可用昵称，也可用 UID
const assert = require('assert');
const path = require('path');
const storage = require('../../lib/storage');
const auth = require('../../lib/auth');

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();

const nickname = 'uid-login-tester';
const password = 'Passw0rd!123';

// 建测试用户
let uid = storage.findUserByNickname(nickname)?.id;
if (!uid) {
    uid = storage.createUser(nickname, password);
}

check('测试用户已创建', () => {
    assert.ok(uid, 'uid 应存在');
});

check('用昵称可以登录', () => {
    const got = auth.login(nickname, password, '127.0.0.1');
    assert.strictEqual(got, uid, '应返回同一 uid，实际 ' + got);
});

check('用 UID 可以登录', () => {
    const got = auth.login(uid, password, '127.0.0.1');
    assert.strictEqual(got, uid, '应返回同一 uid，实际 ' + got);
});

check('UID 登录密码错误仍被拒', () => {
    const got = auth.login(uid, 'wrong-password', '127.0.0.1');
    assert.strictEqual(got, null, '密码错误应返回 null');
});

check('不存在的 UID 无法登录', () => {
    const got = auth.login('999999999', password, '127.0.0.1');
    assert.strictEqual(got, null);
});

check('UID 带空格也能登录（会 trim）', () => {
    const got = auth.login('  ' + uid + '  ', password, '127.0.0.1');
    assert.strictEqual(got, uid);
});

check('findByAccount 两种写法都能找到人', () => {
    assert.strictEqual(auth.findByAccount(nickname).id, uid);
    assert.strictEqual(auth.findByAccount(uid).id, uid);
    assert.strictEqual(auth.findByAccount('nope'), null);
});

check('系统账户不能通过 UID 登录', () => {
    const got = auth.login(String(storage.SYSTEM_UID), password, '127.0.0.1');
    assert.strictEqual(got, null, '系统账户应被拒绝');
});

check('限流键统一：昵称与 UID 共用一份配额', () => {
    const src = require('fs').readFileSync(
        path.join(__dirname, '../../lib/auth/rate-limit.js'), 'utf8');
    assert.ok(src.includes('function accountKey'), '应存在 accountKey 归一化');
    // 三处都应走 accountKey
    const uses = (src.match(/accountKey\(/g) || []).length;
    assert.ok(uses >= 4, 'check/note/noteSuccess 都应走 accountKey，实际 ' + uses);
    // 不得再有直接用原始输入的
    assert.ok(!/byAccount\.(get|delete|hit)\(String\(/.test(src),
        '不应直接用原始输入当限流键');
});

check('登录页提示已改为「昵称或 UID」', () => {
    const tpl = require('fs').readFileSync(
        path.join(__dirname, '../../templates/login.html'), 'utf8');
    assert.ok(tpl.includes('昵称或 UID'), '登录页应提示支持 UID');
});

console.log('\n======== [回归] UID 登录 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
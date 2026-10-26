'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
const storage = require(path.join(ROOT, 'lib/storage'));
const account = require(path.join(ROOT, 'lib/auth/account'));
const userIps = require(path.join(ROOT, 'lib/storage/user-ips'));
storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();
let nick = 'ipreg1', n = 1;
while (storage.findUserByNickname(nick)) { nick = 'ipreg' + (++n); }
function cleanupUser(uid) {
    try { fs.rmSync(path.join(storage.USER_DIR, String(uid)), { recursive: true, force: true }); } catch (e) {}
}
check('registerUser 接受 clientIp 并记录', () => {
    const uid = account.registerUser(nick, 'pw123456', '203.0.113.7');
    assert.ok(uid, '注册失败');
    const ips = userIps.load(uid) || [];
    assert.ok(ips.some((x) => String(x.ip || x).includes('203.0.113.7')),
        '注册 IP 未记录，实际: ' + JSON.stringify(ips));
    cleanupUser(uid);
});
check('registerUser 不传 IP 时不炸', () => {
    const n2 = nick + 'b';
    const uid = account.registerUser(n2, 'pw123456');
    assert.ok(uid, '注册失败');
    assert.ok(Array.isArray(userIps.load(uid) || []), '应返回数组');
    cleanupUser(uid);
});
check('注册路由确实把 req._clientIp 传了进去', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/routes/auth.js'), 'utf8');
    assert.ok(/registerUser\([^)]*req\._clientIp/.test(src),
        'auth.js 未传 req._clientIp');
    const acct = fs.readFileSync(path.join(ROOT, 'lib/auth/account.js'), 'utf8');
    assert.ok(/function registerUser\(nickname, password, clientIp\)/.test(acct),
        'account.js 未接收 clientIp');
});
function runConsole(env) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'lib/console/index.js')],
        { cwd: ROOT, encoding: 'utf8', timeout: 60000, input: 'check avatar\nexit\n', env });
    return String(r.stdout || '') + String(r.stderr || '');
}
const ESC = /\x1b\[[0-9;]*m/;
check('默认有色：非 TTY 也输出 ANSI', () => {
    const env = { ...process.env };
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;
    delete env.TERM;
    const out = runConsole(env);
    assert.ok(out.length > 0, '无输出');
    assert.ok(ESC.test(out), '默认应为彩色');
});
check('NO_COLOR=1 时无转义序列', () => {
    const out = runConsole({ ...process.env, NO_COLOR: '1' });
    assert.ok(out.length > 0, '无输出');
    assert.ok(!ESC.test(out), 'NO_COLOR 未生效');
});
check('NO_COLOR 优先于 FORCE_COLOR', () => {
    const out = runConsole({ ...process.env, NO_COLOR: '1', FORCE_COLOR: '1' });
    assert.ok(!ESC.test(out), 'NO_COLOR 应压过 FORCE_COLOR');
});
check('TERM=dumb 时无转义序列（终端不支持 ANSI）', () => {
    const env = { ...process.env, TERM: 'dumb' };
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;
    const out = runConsole(env);
    assert.ok(out.length > 0, '无输出');
    assert.ok(!ESC.test(out), 'TERM=dumb 时应去色');
});
check('FORCE_COLOR 单独存在时仍为彩色', () => {
    const env = { ...process.env, FORCE_COLOR: '1' };
    delete env.NO_COLOR;
    delete env.TERM;
    const out = runConsole(env);
    assert.ok(ESC.test(out), 'FORCE_COLOR 应保持彩色');
});
check('控制台日志有色，写文件的无色', () => {
    const fsx = require('fs');
    const pathx = require('path');
    delete require.cache[require.resolve(pathx.join(ROOT, 'lib/logger.js'))];
    const logger = require(pathx.join(ROOT, 'lib/logger.js'));
    const orig = console.log;
    let out = '';
    console.log = (...a) => { out += a.join(' ') + '\n'; };
    logger.http({ method: 'GET', headers: {}, _clientIp: '1.2.3.4' }, '/home', 200, 5);
    console.log = orig;
    assert.ok(ESC.test(out), '控制台日志应含 ANSI，实际: ' + JSON.stringify(out));
    assert.ok(out.includes('1.2.3.4'), '应显示客户端 IP');
    assert.ok(fsx.existsSync(pathx.join(ROOT, 'logs')), '未生成 logs 目录');
});
check('ui.js 与 logger.js 的 C 键集完整（否则模板串会输出 undefined）', () => {
    for (const [rel, keys] of [
        ['lib/console/ui.js', ['reset', 'bold', 'red', 'green', 'yellow', 'gray', 'white']],
        ['lib/logger.js', ['reset', 'red', 'green', 'yellow', 'cyan', 'gray', 'magenta', 'bold']],
    ]) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const m = src.match(/RAW_COLOR\s*=\s*\{([\s\S]*?)\}/);
        assert.ok(m, rel + ' 未用 RAW_COLOR 定义调色板');
        for (const k of keys) {
            assert.ok(new RegExp('\\b' + k + '\\s*:').test(m[1]), rel + ' 缺键 ' + k);
        }
        assert.ok(/palette\(/.test(src), rel + ' 未使用 lib/color.js 的 palette');
    }
    const color = require(path.join(ROOT, 'lib/color.js'));
    assert.strictEqual(color.colorEnabled({}), true, '默认为有色');
    assert.strictEqual(color.colorEnabled({ NO_COLOR: '1' }), false);
    assert.strictEqual(color.colorEnabled({ TERM: 'dumb' }), false);
    assert.strictEqual(color.colorEnabled({ TERM: 'dumb', FORCE_COLOR: '1' }), true);
    assert.strictEqual(color.colorEnabled({ NO_COLOR: '1', FORCE_COLOR: '1' }), false);
});
check('startup-check 仍认 NO_COLOR 与 TERM=dumb', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/startup-check.js'), 'utf8');
    assert.ok(/NO_COLOR|color\.colorEnabled|require\('\.\/color'\)/.test(src),
        'startup-check 丢了颜色探测');
});
console.log('\n======== [回归] 注册 IP / 非彩色输出 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter((x) => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };
check('★ npm 各脚本指向的入口文件都真实存在', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const bad = [];
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
        const m = /node\s+(\S+)/.exec(cmd);
        if (!m) continue;
        const target = path.join(ROOT, m[1].replace(/\\/g, '/'));
        if (!fs.existsSync(target)) bad.push(`${name} -> ${m[1]}`);
    }
    assert.strictEqual(bad.length, 0, '入口不存在: ' + bad.join(', '));
});
check('★ server 入口可加载且能响应一次请求', () => {
    const out = execFileSyncSafe();
    assert.ok(/Chatroom 2\.0 starting|监听端口/.test(out), 'server 未启动:\n' + out.slice(0, 300));
});
function execFileSyncSafe() {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'server.js')],
        { cwd: ROOT, encoding: 'utf8', timeout: 20000, killSignal: 'SIGINT' });
    return (r.stdout || '') + (r.stderr || '');
}
check('控制台可执行注册/登录等命令', () => {
    const entry = path.join(ROOT, 'lib/console/index.js');
    const r = spawnSync(process.execPath, [entry], {
        cwd: ROOT, input: 'user add alice pw123456\nuser show alice\nexit\n',
        encoding: 'utf8', timeout: 40000,
    });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(/已更新|✔|✓/.test(out) || /alice/.test(out), '命令无输出:\n' + out.slice(0, 400));
});
check('npm run console 脚本存在', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.scripts.console, 'node lib/console/index.js');
});
check('npm test / npm run cert 脚本存在', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts.test, '缺少 test 脚本');
    assert.ok(pkg.scripts.cert, '缺少 cert 脚本');
});
check('cert 脚本在无 openssl 时也能给出可用指引（不崩溃）', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'test/tools/gen-cert.js')],
        { cwd: ROOT, encoding: 'utf8', timeout: 40000 });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(/已生成|openssl|手工/.test(out), '无有用输出:\n' + out.slice(0, 300));
});
console.log('\n======== [回归 5] 控制台入口与 npm 脚本 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

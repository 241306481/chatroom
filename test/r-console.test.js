// [回归 5] 控制台：双击 chatroom_console.bat 能进入
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = 'D:/chatroom';
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

check('★ 启动器指向真实存在的入口（之前指向不存在的 lib/console.js）', () => {
    const bat = fs.readFileSync(path.join(ROOT, 'chatroom_console.bat'), 'utf8');
    const m = bat.match(/node\s+"%~dp0([^"]+)"/);
    assert.ok(m, '未找到 node 调用');
    const target = path.join(ROOT, m[1].replace(/\\/g, '/'));
    assert.ok(fs.existsSync(target), '入口不存在: ' + m[1]);
    assert.ok(/lib[\\/]console[\\/]index\.js/.test(m[1]), '入口不是 lib/console/index.js');
});

check('★ 启动器实际可执行（模拟双击：cd 到目录后运行）', () => {
    const bat = fs.readFileSync(path.join(ROOT, 'chatroom_console.bat'), 'utf8');
    const m = bat.match(/node\s+"%~dp0([^"]+)"/);
    const entry = path.join(ROOT, m[1].replace(/\\/g, '/'));
    const r = spawnSync(process.execPath, [entry],
        { cwd: ROOT, input: 'exit\n', encoding: 'utf8', timeout: 40000 });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(/Chatroom Console/.test(out), '控制台未启动:\n' + out.slice(0, 400));
    assert.notStrictEqual(r.status, 1, '控制台异常退出');
});

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
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen-cert.js')],
        { cwd: ROOT, encoding: 'utf8', timeout: 40000 });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(/已生成|openssl|手工/.test(out), '无有用输出:\n' + out.slice(0, 300));
});

console.log('\n======== [回归 5] 控制台启动器 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
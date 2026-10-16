const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'item');

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

const SUITES = [
    'guard-test.js',
    'permission-test.js',
    'exp-test.js',
    'editor-test.js',
    'auth-test.js',
    'ban-until-test.js',
    'avatar-test.js',
    'route-safety-test.js',
    'tls-test.js',
    'console-test.js',
    'console-check-test.js',
    'console-cmds-test.js',
    'css-split-test.js',
    'log-test.js',
];

const encoding = require('./check-encoding').run();
if (encoding.problems.length) {
    console.error('编码检查未通过：');
    for (const p of encoding.problems) console.error('  ' + p);
    console.error('\n中文很可能已被按错误代码页读写损坏。');
    console.error('请用 Node fs(..., "utf8") 或编辑器的编辑 API 修复，');
    console.error('详见 CONTRIBUTING.md 的「文件读写约束」。');
    process.exit(1);
}
console.log(`encoding                OK (${encoding.count} files, no BOM / U+FFFD)`);

for (const f of ['cert.pem', 'key.pem']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) { try { fs.rmSync(p); } catch (e) {} }
}

let pass = 0, fail = 0;
for (const s of SUITES) {
    const f = path.join(TMP, s);
    if (!fs.existsSync(f)) {
        console.log(`${s.padEnd(26)} MISSING`);
        fail++;
        continue;
    }
    for (const d of ['data', 'logs', 'evil', 'evil.json']) {
        const p = path.join(ROOT, d);
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
    let out = '';
    try {
        out = execFileSync(process.execPath, [f],
            { cwd: ROOT, encoding: 'utf8', timeout: 180000, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
        out = (e.stdout || '') + (e.stderr || '');
    }
    const m = out.match(/(\d+) passed, (\d+) failed/);
    const line = m ? m[0] : 'NO RESULT';
    if (m && +m[2] === 0) pass += +m[1]; else { fail++; console.log(out.slice(-2500)); }
    console.log(`${s.padEnd(26)} ${line}`);
}
console.log('-'.repeat(50));
console.log(`${pass} passed, ${fail > 0 ? fail : 0} failed`);
process.exit(fail > 0 ? 1 : 0);
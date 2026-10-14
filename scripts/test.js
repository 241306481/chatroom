// 回归测试入口：npm test
// 每个用例都是独立进程 + 独立数据目录，互不干扰。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'test');

if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

const SUITES = [
    'r-guard.test.js',
    'r-permission.test.js',
    'r-exp.test.js',
    'r-editor.test.js',
    'r-auth.test.js',
    'r-tls.test.js',
    'r-console.test.js',
    'r-log.test.js',
];

// r-tls 会生成证书并清理；一旦残留，server.js 会自动切到 HTTPS，
// 导致其它按明文 HTTP 跑��套件出现 socket hang up。这里兜底清理。
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
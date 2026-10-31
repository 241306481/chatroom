const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'item');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const SUITES = [
    'guard-test.js',
    'register-domain-test.js',
    'rate-limit-test.js',
    'uid-login-test.js',
    'perm-bits-test.js',
    'perm-audit-test.js',
    'permission-test.js',
    'exp-test.js',
    'editor-test.js',
    'help-test.js',
    'batch-ops-test.js',
    'auth-test.js',
    'ban-until-test.js',
    'avatar-test.js',
    'profile-avatar-test.js',
    'register-ip-color-test.js',
    'route-safety-test.js',
    'tls-test.js',
    'dm-image-test.js',
    'dm-storage-test.js',
    'chunks-atomic-test.js',
    'zip-test.js',
    'attachment-route-test.js',
    'console-test.js',
    'console-check-test.js',
    'console-cmds-test.js',
    'css-split-test.js',
    'markdown-test.js',
    'highlight-test.js',
    'dom-sanitize-test.js',
    'shutdown-conn-test.js',
    'shutdown-test.js',
    'search-perf-test.js',
    'search-page-test.js',
    'member-bar-test.js',
    'domain-notify-test.js',
    'flash-test.js',
    'log-test.js',
    'backup-test.js',
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
let pass = 0, fail = 0, skip = 0;
const skipWhy = [];
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
    const m = out.match(/(\d+) passed, (\d+) failed(?:, (\d+) skipped)?/);
    const sk = m && m[3] ? +m[3] : 0;
    const line = m ? m[0] : 'NO RESULT';
    if (m && +m[2] === 0) pass += +m[1]; else { fail++; console.log(out.slice(-2500)); }
    if (sk) {
        skip += sk;
        const r = out.split('\n').find((l) => l.startsWith('SKIP: '));
        skipWhy.push({ suite: s, n: sk, reason: r ? r.slice(5).trim() : '未说明原因' });
    }
    console.log(`${s.padEnd(26)} ${line}`);
}
for (const d of ['data', 'logs', 'evil', 'evil.json', 'cert.pem', 'key.pem']) {
    const p = path.join(ROOT, d);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
if (skipWhy.length) {
    console.log('-'.repeat(50));
    console.log(`跳过 ${skip} 项（不计入失败）：`);
    for (const w of skipWhy) {
        console.log(`  ${w.suite}  ${w.n} 项`);
        console.log(`    ${w.reason}`);
    }
    console.log('-'.repeat(50));
}
const total = `${pass} passed, ${fail > 0 ? fail : 0} failed`
    + (skip ? `, ${skip} skipped` : '');
console.log(total);
process.exit(fail > 0 ? 1 : 0);

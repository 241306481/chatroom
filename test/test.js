const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, 'test', 'item');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });
const GROUPS = [
    {
        name: '账号与权限',
        suites: ['auth-test.js', 'guard-test.js', 'permission-test.js'],
    },
    {
        name: '网络与安全',
        suites: ['rate-limit-test.js', 'route-safety-test.js', 'stage3-security-test.js'],
    },
    {
        name: '消息与文件',
        suites: [
            'batch-ops-test.js', 'dm-storage-test.js', 'dom-sanitize-test.js',
            'attachment-route-test.js', 'storage-integrity-test.js',
        ],
    },
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
let pass = 0, fail = 0, suitePass = 0, suiteFail = 0;
for (const group of GROUPS) {
    const details = [];
    let groupFail = 0;
    for (const s of group.suites) {
        const f = path.join(TMP, s);
        if (!fs.existsSync(f)) {
            groupFail++;
            suiteFail++;
            details.push(`${s} MISSING`);
            continue;
        }
        for (const d of ['data', 'logs', 'evil', 'evil.json']) {
            const p = path.join(ROOT, d);
            if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
        }
        let out = '';
        try {
            out = execFileSync(process.execPath, [f], {
                cwd: ROOT, encoding: 'utf8', timeout: 180000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (e) {
            out = (e.stdout || '') + (e.stderr || '');
        }
        const m = out.match(/(\d+) passed, (\d+) failed(?:, (\d+) skipped)?/);
        if (m && +m[2] === 0) {
            suitePass++;
        } else {
            groupFail++;
            suiteFail++;
            details.push(`${s}\n${out.slice(-2500)}`);
        }
    }
    if (groupFail) {
        fail++;
        console.log(`${group.name.padEnd(18)} FAIL (${groupFail}/${group.suites.length})`);
        console.log(details.join('\n').trimEnd());
    } else {
        pass++;
        console.log(`${group.name.padEnd(18)} PASS (${group.suites.length})`);
    }
}
for (const d of ['data', 'logs', 'evil', 'evil.json', 'cert.pem', 'key.pem']) {
    const p = path.join(ROOT, d);
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed (${suitePass + suiteFail} suites)`);
process.exit(fail > 0 ? 1 : 0);

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
function walk(dir, out) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p, out);
        else if (/\.(?:html|js)$/.test(name)) out.push(p);
    }
    return out;
}
const templates = walk(path.join(ROOT, 'templates'), [])
    .filter((p) => p.endsWith('.html'));
const jsFiles = walk(path.join(ROOT, 'static', 'js'), [])
    .concat([path.join(ROOT, 'lib', 'template.js')]);
check('模板与静态 JS 不再含内联事件属性', () => {
    const bad = [];
    for (const p of templates.concat(jsFiles)) {
        const src = fs.readFileSync(p, 'utf8');
        if (/(?:^|[\s"'}>%])on(?:click|error|change|submit|load|mouseover|focus|blur)\s*=/i.test(src)) {
            bad.push(p);
        }
    }
    assert.deepStrictEqual(bad, [], '仍含内联事件属性');
});
check('模板与错误页不再含 javascript: URL', () => {
    const bad = [];
    for (const p of templates.concat([path.join(ROOT, 'lib', 'template.js')])) {
        if (/javascript:/i.test(fs.readFileSync(p, 'utf8'))) bad.push(p);
    }
    assert.deepStrictEqual(bad, [], '仍含 javascript: URL');
});
check('全部内联 script 均带 nonce', () => {
    const bad = [];
    for (const p of templates) {
        const src = fs.readFileSync(p, 'utf8');
        const re = /<script\b([^>]*)>/gi;
        let m;
        while ((m = re.exec(src))) {
            const attrs = m[1];
            if (!/\bsrc\s*=/i.test(attrs) && !/\bnonce\s*=/i.test(attrs)) {
                bad.push(path.relative(ROOT, p));
            }
        }
    }
    assert.deepStrictEqual(bad, [], '存在未加 nonce 的内联 script');
});
check('CSP 使用每请求 nonce，样式暂保留 unsafe-inline', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'routes', 'index.js'), 'utf8');
    assert.ok(/crypto\.randomBytes\(16\)/.test(src), '未生成随机 nonce');
    assert.ok(/res\._cspNonce\s*=\s*cspNonce/.test(src), '未挂载 nonce');
    assert.ok(/script-src[^;]*'nonce-/.test(src), 'script-src 缺少 nonce');
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(src), 'script-src 仍含 unsafe-inline');
    assert.ok(/style-src[^;]*'unsafe-inline'/.test(src), 'style-src 应暂留 unsafe-inline');
});
check('模板渲染上下文注入 csp_nonce', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'template.js'), 'utf8');
    assert.ok(/function withCspNonce/.test(src), '缺少 nonce 注入');
    assert.ok(/csp_nonce:\s*\(res && res\._cspNonce\)/.test(src), 'nonce 未写入上下文');
});
console.log('\n======== [回归] CSP nonce 化 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter((x) => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

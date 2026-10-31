const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const results = [];
const check = (name, fn) => {
    try { fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); }
};
const html = fs.readFileSync(path.join(ROOT, 'templates/help.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'static/css/help.css'), 'utf8');
check('帮助目录与栏目一一对应', () => {
    const nav = html.match(/<nav class="help-toc"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(nav, '缺少帮助目录');
    const ids = [...nav[1].matchAll(/<a href="#([^"]+)">/g)].map(m => m[1]);
    assert.ok(ids.length >= 6, '目录栏目过少');
    assert.strictEqual(new Set(ids).size, ids.length, '目录存在重复锚点');
    for (const id of ids) {
        assert.ok(html.includes(`<section id="${id}" `), '目录缺少对应栏目：' + id);
    }
});
check('帮助目录为右侧栏并带链接样式', () => {
    assert.ok(html.includes('class="help-content"'), '帮助正文缺少布局容器');
    assert.ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+210px/.test(css),
        '帮助页未声明右侧目录栏');
    assert.ok(/\.help-toc\s*\{[\s\S]*?position:\s*sticky/.test(css),
        '帮助目录未吸顶');
    assert.ok(/\.help-toc a\s*\{[\s\S]*?padding:/.test(css),
        '帮助目录链接缺少按钮样式');
});
check('帮助包含粘贴图片与批量说明', () => {
    assert.ok(html.includes('<kbd>Ctrl+V</kbd>'), '缺少粘贴图片快捷键');
    assert.ok(html.includes('批量下载为 ZIP'), '缺少批量下载说明');
    assert.ok(html.includes('general 不可删除'), '缺少删除讨论限制');
});
for (const [st, n] of results) console.log(st + '  ' + n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;

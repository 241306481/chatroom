'use strict';
const assert = require('assert');
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', '..', 'static', 'js', 'core', 'highlight.js'));
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
function render(lang, text, options, noClass) {
    const code = { className: noClass ? '' : 'language-' + lang, textContent: text, innerHTML: text };
    const pre = {
        dataset: {},
        classList: {
            add(c) { (this.list = this.list || []).push(c); },
            contains(c) { return (this.list || []).indexOf(c) >= 0; },
        },
    };
    if (options) pre.dataset.codeOptions = options;
    if (noClass) pre.dataset.lang = lang;
    pre.insertAdjacentHTML = function (pos, html) { this.inserted = html; };
    code.parentElement = pre;
    window.highlightCode({ querySelectorAll: () => [code] });
    return { html: code.innerHTML, pre };
}
check('cpp：预处理、关键字、函数、字符串、数字', () => {
    const r = render('cpp', '#include <iostream>\nint main(){ return 42; }');
    assert.ok(r.html.includes('tok-pre'));
    assert.ok(r.html.includes('tok-kw'));
    assert.ok(r.html.includes('tok-fn'));
    assert.ok(r.html.includes('tok-num'));
    assert.ok(r.html.includes('token keyword'));
    assert.strictEqual(r.pre.dataset.lang, 'cpp');
});
check('python：注释、关键字、函数、三引号字符串', () => {
    const r = render('python', '# hi\ndef f():\n    return """x"""');
    assert.ok(r.html.includes('tok-com'));
    assert.ok(r.html.includes('tok-kw'));
    assert.ok(r.html.includes('tok-fn'));
    assert.ok(r.html.includes('tok-str'));
});
check('html：标签与属性值', () => {
    const r = render('html', '<div class="x">a</div>');
    assert.ok(r.html.includes('tok-tag'));
    assert.ok(r.html.includes('tok-str'));
});
check('未知语言按纯文本并保留行号', () => {
    const a = render('text', '<b>x</b>', 'line-numbers');
    const b = render('unknown', '<b>x</b>', 'line-numbers');
    assert.ok(!a.html.includes('tok-'));
    assert.ok(!b.html.includes('tok-'));
    assert.ok(a.pre.classList.contains('line-numbers'));
    assert.ok(a.html.includes('line-numbers-rows'));
    assert.strictEqual(a.pre.dataset.lang, 'text');
    assert.strictEqual(b.pre.dataset.lang, 'unknown');
});
check('无语言默认按 C++ 高亮', () => {
    const r = render('cpp', 'int x = 1;', '', true);
    assert.ok(r.html.includes('tok-kw'));
    assert.strictEqual(r.pre.dataset.lang, 'cpp');
});
check('默认不生成行号', () => {
    const r = render('cpp', 'a\nb\nc');
    assert.ok(!r.pre.classList.contains('line-numbers'));
    assert.ok(!r.html.includes('line-numbers-rows'));
});
check('line-numbers 参数显示行号', () => {
    const r = render('cpp', 'a\nb', 'line-numbers');
    assert.ok(r.pre.classList.contains('line-numbers'));
    assert.strictEqual((r.html.match(/line-numbers-rows/g) || []).length, 1);
    assert.strictEqual((r.html.match(/<span><\/span>/g) || []).length, 2);
});
check('lines= 只高亮不生成行号', () => {
    const r = render('cpp', 'a\nb\nc\nd\ne\nf', 'lines=5-6');
    assert.ok(!r.pre.classList.contains('line-numbers'));
    assert.ok(!r.html.includes('line-numbers-rows'));
    assert.ok(r.pre.inserted.includes('data-range="5-6"'));
    assert.ok(r.pre.inserted.includes('--start:5;--end:6;'));
});
check('line-numbers 与 lines= 同时显示行号', () => {
    const r = render('cpp', 'a\nb\nc\nd\ne\nf', 'line-numbers lines=5-6');
    assert.ok(r.pre.classList.contains('line-numbers'));
    assert.ok(r.html.includes('line-numbers-rows'));
    assert.ok(r.pre.inserted.includes('data-range="5-6"'));
});
console.log('\n======== [回归] 代码高亮 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(results.length - failed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

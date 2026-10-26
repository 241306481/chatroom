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
const L = fs.readFileSync(path.join(ROOT, 'static/js/core/dom.js'), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n');
function mkRoot(tags) {
    const nodes = tags.map((t) => ({
        attributes: Object.keys(t).map((k) => ({ name: k, value: t[k] })),
        removeAttribute(n) { this.attributes = this.attributes.filter((a) => a.name !== n); },
        remove() { this.removed = true; },
    }));
    return {
        nodes,
        querySelectorAll(sel) { return sel.includes(',') ? [] : nodes; },
    };
}
function loadSanitize() {
    const i0 = L.findIndex((l) => l.startsWith('const DANGEROUS_SCHEME_RE'));
    let i1 = -1;
    for (let i = i0; i < L.length; i++) {
        if (/^function sanitize\(root\) \{/.test(L[i])) {
            for (let j = i; j < L.length; j++) { if (L[j] === '}') { i1 = j; break; } }
            break;
        }
    }
    assert.ok(i0 >= 0 && i1 > i0, '未找到 sanitize 定义');
    return new Function(L.slice(i0, i1 + 1).join('\n')
        + ' return { sanitize, URL_ATTRS };')();
}
let SAN;
check('sanitize 声明在模块作用域，不在函数体内', () => {
    const i0 = L.findIndex((l) => l.startsWith('const DANGEROUS_SCHEME_RE'));
    assert.ok(i0 >= 0, 'DANGEROUS_SCHEME_RE 应在顶层');
    assert.ok(/^function sanitize\(/.test(L.find((l) => /^function sanitize\(/.test(l)) || ''),
        'sanitize 应是顶层函数');
    const fn = L.join('\n');
    const topDecl = (fn.match(/^const URL_ATTRS/gm) || []).length;
    assert.strictEqual(topDecl, 1, 'URL_ATTRS 应只声明一次');
    SAN = loadSanitize();
});
check('URL_ATTRS 覆盖常见注入面', () => {
    assert.ok(SAN);
    for (const a of ['href', 'src', 'action', 'formaction', 'xlink:href', 'srcset']) {
        assert.ok(SAN.URL_ATTRS.includes(a), '缺属性 ' + a);
    }
});
check('sanitize 可直接调用（曾因 TDZ 抛错）', () => {
    assert.ok(SAN);
    SAN.sanitize(mkRoot([{ href: '/ok' }]));
});
check('正常链接不被误伤', () => {
    for (const v of ['http://1.1.1.1', 'https://x.com', '/user/1', '#anchor']) {
        const r = mkRoot([{ href: v }]);
        SAN.sanitize(r);
        assert.ok(r.nodes[0].attributes.some((a) => a.name === 'href'), v + ' 被误删');
    }
});
check('危险协议被剥掉（含变形写法）', () => {
    const bad = [
        ['href', 'javascript:alert(1)'],
        ['href', 'JaVaScRiPt:alert(1)'],
        ['href', 'java\tscript:alert(1)'],
        ['href', ' javascript:alert(1)'],
        ['src', 'data:text/html,<script>'],
        ['href', 'vbscript:msgbox'],
    ];
    for (const [attr, val] of bad) {
        const r = mkRoot([{ [attr]: val }]);
        SAN.sanitize(r);
        assert.ok(!r.nodes[0].attributes.some((a) => a.name === attr),
            attr + '=' + JSON.stringify(val) + ' 未被剥掉');
    }
});
check('class / style / align 等精细 HTML 属性保留', () => {
    const r = mkRoot([{ class: 'box', style: 'color:red', align: 'center', 'data-x': '1' }]);
    SAN.sanitize(r);
    for (const a of ['class', 'style', 'align', 'data-x']) {
        assert.ok(r.nodes[0].attributes.some((x) => x.name === a), a + ' 被误删');
    }
});
check('危险内联样式被剥掉', () => {
    for (const v of ['position:fixed;top:0', 'background:url(javascript:alert(1))',
        'width:expression(alert(1))', 'behavior:url(x.htc)']) {
        const r = mkRoot([{ style: v }]);
        SAN.sanitize(r);
        assert.ok(!r.nodes[0].attributes.some((a) => a.name === 'style'), v + ' 未被剥掉');
    }
});
check('on* 事件属性被剥掉', () => {
    for (const attr of ['onclick', 'onerror', 'onload', 'onmouseover']) {
        const r = mkRoot([{ [attr]: 'x()' }]);
        SAN.sanitize(r);
        assert.strictEqual(r.nodes[0].attributes.length, 0, attr + ' 未被剥掉');
    }
});
check('危险标签整节点移除', () => {
    for (const tag of ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form']) {
        let removed = false;
        SAN.sanitize({
            querySelectorAll(sel) {
                if (sel.includes(',')) return [{ remove() { removed = true; } }];
                return [];
            },
        });
        assert.ok(removed, tag + ' 未触发移除');
    }
});
console.log('\n======== [回归] 前端清洗 sanitize ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter((x) => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

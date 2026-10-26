'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
global.window = { marked: require(path.join(ROOT, 'static/markdown/marked.min.js')) };
require(path.join(ROOT, 'static/js/core/markdown.js'));
const md = window.LuoguMarkdown;
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
function cell(text, row) {
    return {
        textContent: text, children: [], rowSpan: 1, colSpan: 1, row: row,
        remove() {
            this.removed = true;
            const i = this.row.cells.indexOf(this);
            if (i >= 0) this.row.cells.splice(i, 1);
        },
    };
}
function table(rows) {
    return {
        rows: rows.map(cells => {
            const row = { cells };
            for (const c of cells) c.row = row;
            return row;
        }),
    };
}
check('Callout：标题、默认展开、正文 Markdown', () => {
    const html = md.parse(':::info[标题]{open}\n**重点**\n:::');
    assert.ok(html.includes('class="info" open'));
    assert.ok(html.includes('<summary>标题</summary>'));
    assert.ok(html.includes('<strong>重点</strong>'));
    assert.ok(!html.includes('md-callout-icon'));
});
check('Callout：四种类型与默认标题', () => {
    for (const name of ['info', 'success', 'warning', 'error']) {
        const html = md.parse(':::' + name + '\n内容\n:::');
        assert.ok(html.includes('<details class="' + name + '">'), name + ' 缺少类型样式');
    }
});
check('Callout：父容器冒号多于子容器时可嵌套', () => {
    const html = md.parse(':::::warning[父]\n外\n::::success[子]{open}\n内\n::::\n:::::');
    assert.ok(html.indexOf('class="warning"') < html.indexOf('class="success"'));
    assert.ok(html.includes('class="warning"><summary>'));
    assert.ok(html.includes('class="success" open>'));
});
check('代码围栏内的 ::: 不按容器解析', () => {
    const f = String.fromCharCode(96).repeat(3);
    const html = md.parse(f + 'md\n:::info\nx\n:::\n' + f);
    assert.ok(html.includes(':::info'));
    assert.ok(!html.includes('<details'));
});
check('HTML 预格式化块内的 ::: 不按容器解析', () => {
    const html = md.parse('<pre>\n:::info\nx\n:::\n</pre>');
    assert.ok(html.includes(':::info'));
    assert.ok(!html.includes('<details'));
});
check('左对齐 / 居中 / 右对齐', () => {
    for (const dir of ['left', 'center', 'right']) {
        const html = md.parse(':::align{' + dir + '}\n内容\n:::');
        assert.ok(html.includes('<p style="text-align: ' + dir + ';">内容</p>'),
            dir + ' 未生效');
    }
});
check('嵌套对齐：内层对齐不被外层覆盖', () => {
    const html = md.parse('::::align{right}\n外\n\n:::align{center}\n内\n:::\n\n外\n::::');
    assert.ok(html.includes('<p style="text-align: center;">内</p>'));
    assert.ok(html.includes('<p style="text-align: right;">外</p>'));
});
check('Epigraph：正文与落款', () => {
    const html = md.parse(':::epigraph[——otto]\n引言\n:::');
    assert.ok(html.includes('class="epigraph has-source"'));
    assert.ok(html.includes('<p>引言</p>'));
    assert.ok(html.includes('<p>——otto</p>'));
    assert.ok(!html.includes('<figure'));
    assert.ok(!html.includes('<blockquote'));
});
check('GFM：表格列对齐、任务列表、删除线、自动链接', () => {
    const html = md.parse('|左|中|右|\n|:---|:---:|---:|\n|a|b|c|\n\n- [x] 完成\n\n~~删除~~\n\nhttps://example.com');
    assert.ok(html.includes('<th align="center">中</th>'));
    assert.ok(html.includes('<th align="right">右</th>'));
    assert.ok(/<input[^>]*checked[^>]*type="checkbox"/.test(html));
    assert.ok(html.includes('class="task-list-item"'));
    assert.ok(html.includes('<del>删除</del>'));
    assert.ok(html.includes('href="https://example.com"'));
});
check('Cute table：three 容器包裹表格', () => {
    const html = md.parse('::cute-table{three}\n\n|左|右|\n|---|---|\n|a|b|');
    assert.ok(html.includes('<div class="cute-table cute-table-three"><table>'));
    assert.ok(html.includes('<td>a</td>'));
});
check('Cute table：tuack 参数标记加粗竖线列', () => {
    const html = md.parse('::cute-table{tuack=2}\n\n|左|中|右|\n|---|---|---|\n|a|b|c|');
    assert.ok(html.includes('<div class="cute-table cute-table-tuack">'));
    const marked = html.match(/class="cute-table-bold-col"/g) || [];
    assert.strictEqual(marked.length, 2);
});
check('HTML：class / style / mark 保留供精细排版', () => {
    const html = md.parse('<div class="box" style="color:red"><mark>ok</mark></div>');
    assert.ok(html.includes('class="box"'));
    assert.ok(html.includes('style="color:red"'));
    assert.ok(html.includes('<mark>ok</mark>'));
});
check('表格合并：^ 向上合并为 rowspan', () => {
    const r0 = [cell('a'), cell('b')];
    const r1 = [cell('^'), cell('c')];
    md.mergeTable(table([r0, r1]));
    assert.strictEqual(r0[0].rowSpan, 2);
    assert.strictEqual(r1.length, 1);
    assert.strictEqual(r1[0].textContent, 'c');
});
check('表格合并：< 向左合并为 colspan', () => {
    const r0 = [cell('a'), cell('<')];
    md.mergeTable(table([r0]));
    assert.strictEqual(r0[0].colSpan, 2);
    assert.strictEqual(r0.length, 1);
});
check('表格合并：混合合并后列位置正确', () => {
    const r0 = [cell('a'), cell('b'), cell('c')];
    const r1 = [cell('^'), cell('<'), cell('d')];
    md.mergeTable(table([r0, r1]));
    assert.strictEqual(r0[0].rowSpan, 2);
    assert.strictEqual(r0[0].colSpan, 2);
    assert.strictEqual(r1.length, 1);
    assert.strictEqual(r1[0].textContent, 'd');
});
check('页面顺序：marked 后加载 markdown.js，再加载 dom.js', () => {
    const base = fs.readFileSync(path.join(ROOT, 'templates/base.html'), 'utf8');
    const a = base.indexOf('/static/markdown/marked.min.js');
    const b = base.indexOf('/static/js/core/markdown.js');
    const c = base.indexOf('/static/js/core/dom.js');
    assert.ok(a >= 0 && b > a && c > b, '脚本顺序不正确');
});
check('dom.js 通过 LuoguMarkdown 解析并合并表格', () => {
    const src = fs.readFileSync(path.join(ROOT, 'static/js/core/dom.js'), 'utf8');
    assert.ok(src.includes('window.LuoguMarkdown.parse(processed)'));
    assert.ok(src.includes('window.LuoguMarkdown.mergeTables(container)'));
});
check('代码块：无语言默认 C++', () => {
    const html = md.parse('```\nint x;\n```');
    assert.ok(html.includes('class="pre language-cpp"'));
    assert.ok(html.includes('data-lang="cpp"'));
});
check('代码块：语言与 lines 参数保留', () => {
    const html = md.parse('```cpp lines=5-6,11\nint x;\n```');
    assert.ok(html.includes('class="pre language-cpp"'));
    assert.ok(html.includes('data-lang="cpp"'));
    assert.ok(html.includes('data-code-options="lines=5-6,11"'));
});
check('代码块：未知语言保留原标记', () => {
    const html = md.parse('```unknown\n<b>x</b>\n```');
    assert.ok(html.includes('language-unknown'));
    assert.ok(!html.includes('language-cpp'));
});
console.log('\n======== [回归] GFM / 洛谷 Markdown ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(results.length - failed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

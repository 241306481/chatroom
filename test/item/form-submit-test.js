'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const results = [];
const check = (name, fn) => {
    try { fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); }
};
const dom = read('static/js/core/dom.js');
const myfile = read('templates/myfile.html');
const domainFiles = read('templates/domain_files.html');
const base = read('templates/base.html');
check('普通提交使用表单 action，不被按钮默认 formAction 覆盖', () => {
    const m = /const overrideAction = ([\s\S]*?);\s*const action = ([\s\S]*?);/
        .exec(dom);
    assert.ok(m, '未找到 action 计算逻辑');
    assert.match(m[1], /hasAttribute\('formaction'\)/);
    assert.match(m[2], /form\.action/);
    assert.ok(!/submitter\.formAction\) \|\| form\.action/.test(dom),
        '仍无条件使用 submitter.formAction');
});
check('我的文件提供查看入口', () => {
    assert.match(myfile, /href="\/myfile\/\{\{ current_user\.id \}\}\/\{\{ f\.id \}\}"/);
    assert.match(myfile, /target="_blank" rel="noopener" class="file-action-btn">查看<\/a>/);
});
check('域文件提供查看入口', () => {
    assert.match(domainFiles,
        /href="\/domain\/\{\{ domain_name \}\}\/files\/\{\{ f\.id \}\}"/);
    assert.match(domainFiles,
        /target="_blank" rel="noopener" class="file-action-btn">查看<\/a>/);
});
check('复制链接入口已移除', () => {
    assert.ok(!/复制链接|copy-file-link|data-copy-url/.test(myfile + domainFiles));
    assert.ok(!/copy-link\.js/.test(base));
    assert.ok(!fs.existsSync(path.join(ROOT, 'static/js/copy-link.js')));
});
console.log('\n======== [回归] 表单提交与文件查看 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - failed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

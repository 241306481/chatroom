'use strict';
// [回归] CSS 内容合法性
//
// 这里只检验「内容是否合法」：注释语法、括号配对、@import 是否断链。
//
// 刻意不锁定任何具体样式内容、行数或文件大小。把内容冻进测试等于禁止
// 调整样式——改一行 CSS 就红灯，久而久之没人敢动。这里守的是「写出来的
// CSS 一定是浏览器能解析的」，而不是「必须和昨天一模一样」。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CSS = path.join(ROOT, 'static/css');

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

const main = fs.readFileSync(path.join(CSS, 'main.css'), 'utf8');
// 归一化掉 ./ 前缀，才能和文件名列表直接比对
const imports = [...main.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g)]
    .map((m) => m[1].replace(/^\.\//, ''));
const cssFiles = fs.readdirSync(CSS).filter((f) => f.endsWith('.css'));

// ============================================================
// @import 接线
// ============================================================
check('★ main.css 的每个 @import 目标都存在（无断链）', () => {
    assert.ok(imports.length > 0, 'main.css 里没有任何 @import，所有样式都不会生效');
    const missing = imports.filter((t) => !fs.existsSync(path.join(CSS, t)));
    assert.strictEqual(missing.length, 0, '目标不存在: ' + missing.join(', '));
});

check('没有重复导入同一个文件', () => {
    const dup = imports.filter((t, i) => imports.indexOf(t) !== i);
    assert.strictEqual(dup.length, 0, '重复导入: ' + [...new Set(dup)].join(', '));
});

check('除 main.css 外，每个 CSS 文件都已被引入', () => {
    // 某个文件存在却没人 import，等于写了没生效。main.css 本身是入口，不自引。
    const orphans = cssFiles.filter((f) => f !== 'main.css' && !imports.includes(f));
    assert.strictEqual(orphans.length, 0, '存在但未被引入: ' + orphans.join(', '));
});

// ============================================================
// 注释语法
// ============================================================
// CSS 只支持 /* ... */，不支持 //。用 // 写注释时，@import 会被整条忽略，
// 所有样式静默失效，但页面只是「看起来没样式」，控制台零报错。
check('★ 所有 CSS 都不含 // 注释（会让 @import 静默失效）', () => {
    const bad = [];
    for (const f of cssFiles) {
        const s = fs.readFileSync(path.join(CSS, f), 'utf8');
        s.split('\n').forEach((l, i) => {
            // 只看行首的 //：url(https://…) 这类不算
            if (/^\s*\/\//.test(l)) bad.push(f + ':' + (i + 1));
        });
    }
    assert.strictEqual(bad.length, 0, '含 // 注释: ' + bad.join(', '));
});

check('CSS 注释正确闭合且不嵌套', () => {
    // 注释体内出现 /* 会提前终止注释，后面的内容被当作规则解析
    const bad = [];
    for (const f of cssFiles) {
        const s = fs.readFileSync(path.join(CSS, f), 'utf8');
        let depth = 0;
        for (const line of s.split('\n')) {
            const opens = (line.match(/\/\*/g) || []).length;
            const closes = (line.match(/\*\//g) || []).length;
            depth += opens - closes;
            if (depth > 1) { bad.push(f + ' 注释嵌套: ' + line.trim().slice(0, 40)); break; }
        }
        if (depth !== 0) bad.push(f + ' 注释未闭合，depth=' + depth);
    }
    assert.strictEqual(bad.length, 0, bad.join('; '));
});

// ============================================================
// 结构完整性
// ============================================================
check('所有 CSS 的花括号配对', () => {
    const bad = [];
    for (const f of cssFiles) {
        let s = fs.readFileSync(path.join(CSS, f), 'utf8');
        s = s.replace(/\/\*[\s\S]*?\*\//g, '');   // 先去掉注释再数
        const open = (s.match(/\{/g) || []).length;
        const close = (s.match(/\}/g) || []).length;
        if (open !== close) bad.push(f + ' { ' + open + ' 个, } ' + close + ' 个');
    }
    assert.strictEqual(bad.length, 0, bad.join('; '));
});

check('所有 CSS 文件非空', () => {
    const empty = cssFiles.filter((f) => fs.statSync(path.join(CSS, f)).size < 10);
    assert.strictEqual(empty.length, 0, '内容为空或过少: ' + empty.join(', '));
});

check('拆分元数据登记的分片都存在且已被引入', () => {
    // .base-split.json 只用来核对「哪些文件属于拆分产物」这一结构事实，
    // 不校验行数——内容本就可以自由增删。
    const metaPath = path.join(CSS, '.base-split.json');
    if (!fs.existsSync(metaPath)) return;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const names = meta.map((m) => m.name);
    for (const n of names) {
        assert.ok(fs.existsSync(path.join(CSS, n)), n + ' 登记了但文件不存在');
        assert.ok(imports.includes(n), n + ' 未被 main.css 引入');
    }
});

console.log('\n======== [回归] CSS 内容合法性 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter((x) => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

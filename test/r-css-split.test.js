'use strict';
// [回归] base.css 拆分后的不变量
//
// 拆分 base.css 的风险不在语法，而在**层叠顺序**：深色段与文字对比度段
// 有 12 处同选择器不同取值的冲突，谁生效完全由文件内先后决定。
// 本套件把「拼回去 == 原文件」和「导入顺序」都钉死，防止后人调整 @import
// 导致渲染静默改变。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CSS = 'D:/chatroom/static/css';
const ORIG = path.join(__dirname, 'fixtures', 'base.css.orig');

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

const meta = JSON.parse(fs.readFileSync(path.join(CSS, '.base-split.json'), 'utf8'));

check('★ 6 个分片拼接后与原始 base.css 逐字节一致', () => {
    const rebuilt = meta.map(m => {
        const raw = fs.readFileSync(path.join(CSS, m.name), 'utf8');
        const nl = raw.indexOf('\n');
        assert.ok(/^\/\* ===== /.test(raw.slice(0, nl + 1)), m.name + ' 首行缺少哨兵注释');
        return raw.slice(nl + 1).replace(/\n$/, '');
    }).join('\n');
    const orig = fs.readFileSync(ORIG, 'utf8');
    assert.strictEqual(rebuilt, orig,
        '分片拼接结果与原文件不一致，层叠顺序已被破坏');
});

check('切分点连续且覆盖完整（无缝无重叠）', () => {
    let expect = 1;
    for (const m of meta) {
        assert.strictEqual(m.a, expect, m.name + ' 起点不连续，期望 ' + expect + ' 实际 ' + m.a);
        assert.ok(m.b >= m.a, m.name + ' 区间非法');
        expect = m.b + 1;
    }
    const total = meta[meta.length - 1].b;
    const origLines = fs.readFileSync(ORIG, 'utf8').split('\n').length;
    assert.strictEqual(total, origLines,
        '末段终点 ' + total + ' 与原文件行数 ' + origLines + ' 不符');
});

check('每个分片都小于 10KB', () => {
    for (const m of meta) {
        const kb = fs.statSync(path.join(CSS, m.name)).size / 1024;
        assert.ok(kb < 10, m.name + ' 为 ' + kb.toFixed(1) + ' KB，超过 10KB');
    }
});

check('★ main.css 的 @import 顺序与切分顺序一致', () => {
    const main = fs.readFileSync(path.join(CSS, 'main.css'), 'utf8');
    const imports = [...main.matchAll(/@import\s+url\('\.\/([^']+)'\)/g)].map(m => m[1]);
    // 拆分出来的 6 个必须按 meta 顺序、且都排在 topbar.css 之前
    const names = meta.map(m => m.name);
    const idx = names.map(n => imports.indexOf(n));
    for (let i = 0; i < idx.length; i++) {
        assert.ok(idx[i] >= 0, names[i] + ' 未被 main.css 引入');
        if (i > 0) assert.ok(idx[i] > idx[i - 1],
            names[i] + ' 的导入顺序不对（必须排在 ' + names[i - 1] + ' 之后）');
    }
    const topbar = imports.indexOf('topbar.css');
    assert.ok(topbar > idx[idx.length - 1],
        'base 拆分出来的样式必须全部排在 topbar.css 之前，否则层叠关系会变');
});

check('拆分出的 6 个文件都存在且非空', () => {
    for (const m of meta) {
        const p = path.join(CSS, m.name);
        assert.ok(fs.existsSync(p), m.name + ' 不存在');
        assert.ok(fs.statSync(p).size > 500, m.name + ' 内容过少，可能切错');
    }
});

check('没有遗留对旧单体 base.css 的重复内容', () => {
    // base.css 现在只应是第 1 段（重置与通用元素）；若它又包含深色段说明切分被回滚
    const b = fs.readFileSync(path.join(CSS, 'base.css'), 'utf8');
    assert.ok(b.split('\n').length < 200, 'base.css 仍然很大，拆分疑似未生效');
    assert.ok(/box-sizing/.test(b) && /body\s*\{/.test(b), 'base.css 缺少重置规则');
    assert.ok(!/data-theme="dark"/.test(b), 'base.css 里不该再有深色模式规则');
    // 深色段各自都应含 data-theme 钩子
    for (const n of ['dark-core.css', 'dark-ui.css', 'dark-patch.css', 'dark-polish.css']) {
        const s = fs.readFileSync(path.join(CSS, n), 'utf8');
        assert.ok(/data-theme="dark"/.test(s), n + ' 未包含任何深色规则');
    }
});

check('main.css 保留了说明性注释', () => {
    const main = fs.readFileSync(path.join(CSS, 'main.css'), 'utf8');
    assert.ok(/层叠顺序|不可随意调整/.test(main), '缺少顺序说明注释');
});

console.log('\n======== [回归] base.css 拆分不变量 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
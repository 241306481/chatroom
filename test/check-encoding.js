'use strict';
// ============================================================
// 编码守卫
// ============================================================
// 扫描源码里两类「中文已被写坏」的痕迹：
//   1. UTF-8 BOM —— 部分编辑器/脚本会悄悄加上，Node 能容忍，
//      但会让后续按字节比较的工具（比如 grep、git diff --word-diff）
//      出现莫名其妙的首字符差异。
//   2. U+FFFD 替换字符 —— UTF-8 字节被按 GBK/Latin-1 解码后再存回去
//      留下的永久伤疤。中文注释一旦这样损坏，语法仍合法、测试仍全绿，
//      肉眼看终端又常常「好像没问题」，极难发现。
//
// 成因几乎都是同一个：用 PowerShell 的 Get-Content / Set-Content /
// -replace 处理含中文的文件（默认按系统 ANSI 代码页读写，
// 而源文件是 UTF-8）。详见 CONTRIBUTING.md 的「文件读写约束」。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 只扫自己写的代码：static/katex 等第三方产物不归我们管
const DIRS = ['lib', 'test', 'static/js'];
const EXT = new Set(['.js']);

function walk(dir, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules') continue;
            walk(p, out);
        } else if (EXT.has(path.extname(e.name))) {
            out.push(p);
        }
    }
    return out;
}

function run() {
    const files = DIRS.reduce((acc, d) => walk(path.join(ROOT, d), acc), []);
    const problems = [];

    for (const f of files) {
        const buf = fs.readFileSync(f);
        const rel = path.relative(ROOT, f).replace(/\\/g, '/');

        if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
            problems.push(`BOM      ${rel}`);
        }

        // 用 fatal 解码：非法 UTF-8 字节会抛，而不是被悄悄替换成 U+FFFD
        let text;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch (e) {
            problems.push(`非法UTF8 ${rel} -> ${e.message}`);
            continue;
        }
        if (text.includes('\uFFFD')) {
            const line = text.slice(0, text.indexOf('\uFFFD')).split('\n').length;
            problems.push(`U+FFFD   ${rel}:${line}`);
        }
    }

    return { count: files.length, problems };
}

module.exports = { run };

if (require.main === module) {
    const { count, problems } = run();
    if (problems.length) {
        console.error('编码检查未通过：');
        for (const p of problems) console.error('  ' + p);
        console.error('\n这些文件的中文很可能已被按错误代码页读写损坏。');
        console.error('请用 Node fs(..., "utf8") 或编辑器的编辑 API 修复，');
        console.error('详见 CONTRIBUTING.md 的「文件读写约束」。');
        process.exit(1);
    }
    console.log(`编码 OK: ${count} 个文件，无 BOM / 无 U+FFFD`);
}
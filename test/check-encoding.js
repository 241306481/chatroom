'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 跳过第三方产物
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

        // fatal 解码
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
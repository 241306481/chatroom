'use strict';

// 用户头像。固定路径 data/users/<uid>/avatar.<ext>，与「我的文件」解耦

const fs = require('fs');
const path = require('path');
const { userDir } = require('./paths');

const MAX_BYTES = 2 * 1024 * 1024;

// 按魔数判真实格式，不信 Content-Type——否则 .html 改名 .png 就能过白名单
const MAGIC = [
    { ext: 'png',  mime: 'image/png',  test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
    { ext: 'jpg',  mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
    { ext: 'gif',  mime: 'image/gif',  test: (b) => b.length > 6 && b.slice(0, 3).toString('latin1') === 'GIF' && b.slice(3, 6).toString('latin1') === '89a' },
    { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
];
// 不收 SVG：可内嵌脚本，直接访问 URL 就会执行
const DENY_EXT = new Set(['svg', 'svgz', 'html', 'htm', 'js']);

// uid 非法时 userDir 会抛
function avatarPath(uid, ext) {
    return path.join(userDir(uid), 'avatar.' + ext);
}

function sniff(buf) {
    for (const m of MAGIC) {
        try { if (m.test(buf)) return m; } catch (e) {}
    }
    return null;
}

/**
 * 校验并落盘。
 * @returns {{ok:true, ext, mime}|{ok:false, error}}
 */
function save(uid, buf) {
    if (!uid) return { ok: false, error: '缺少 uid' };
    if (!buf || !buf.length) return { ok: false, error: '没有文件' };
    if (buf.length > MAX_BYTES) {
        return { ok: false, error: '头像超过 ' + (MAX_BYTES / 1024 / 1024) + ' MB' };
    }
    const kind = sniff(buf);
    if (!kind) return { ok: false, error: '仅支持 PNG / JPEG / GIF / WebP 图片' };

    let dir;
    try { dir = userDir(uid); }
    catch (e) { return { ok: false, error: '非法 uid' }; }

    // 先删旧的头像，避免换格式后残留两个文件
    clear(uid);

    const p = avatarPath(uid, kind.ext);
    try {
        fs.writeFileSync(p, buf);
    } catch (e) {
        return { ok: false, error: '写入失败：' + e.message };
    }
    return { ok: true, ext: kind.ext, mime: kind.mime };
}

// 删除头像文件，返回是否真的删掉了
function clear(uid) {
    let dir;
    try { dir = userDir(uid); }
    catch (e) { return false; }
    let removed = false;
    for (const m of MAGIC) {
        const p = path.join(dir, 'avatar.' + m.ext);
        try { if (fs.existsSync(p)) { fs.rmSync(p); removed = true; } } catch (e) {}
    }
    return removed;
}

// 读出头像，没有返回 null。ext 需归一大小写：磁盘上永远是 save 时的形态，调用方不一定先归一
function read(uid, ext) {
    const e = String(ext == null ? '' : ext).toLowerCase();
    if (!e || DENY_EXT.has(e)) return null;
    if (!MAGIC.some((m) => m.ext === e)) return null;
    let p;
    try { p = avatarPath(uid, e); } catch (err) { return null; }
    try {
        const buf = fs.readFileSync(p);
        return { buf, mime: (MAGIC.find((m) => m.ext === e) || {}).mime || 'application/octet-stream' };
    } catch (err) {
        return null;
    }
}

module.exports = { MAX_BYTES, save, clear, read, avatarPath };
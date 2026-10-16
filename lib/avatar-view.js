'use strict';

// 无图回退到「首字 + 颜色」
// 白名单须与 avatar.js 的 MAGIC 对齐
const EXTS = new Set(['png', 'jpg', 'gif', 'webp']);

// 只看字段，不查磁盘
function avatarSrc(user) {
    if (!user || !user.avatar_ext) return '';
    const ext = String(user.avatar_ext).toLowerCase();
    if (!EXTS.has(ext)) return '';
    return '/avatar/' + encodeURIComponent(String(user.id || '')) + '/' + ext;
}

// 以磁盘为准；文件已删则返回 ''，回退首字
function avatarExtOnDisk(user) {
    if (!user || !user.id) return '';
    const fs = require('fs');
    const { avatarPath } = require('./storage/avatar');
    for (const ext of EXTS) {
        try { if (fs.existsSync(avatarPath(user.id, ext))) return ext; }
        catch (e) {}
    }
    return '';
}

module.exports = { EXTS, avatarSrc, avatarExtOnDisk };
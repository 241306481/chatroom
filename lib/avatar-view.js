'use strict';

// 头像渲染的公共逻辑，供模板与前端共用。有图用图，无图回退到「首字 + 颜色」。
// 扩展名白名单与 storage/avatar.js 的 MAGIC 对齐
const EXTS = new Set(['png', 'jpg', 'gif', 'webp']);

// 头像图片 URL，没有返回空串。只看字段，不查磁盘
function avatarSrc(user) {
    if (!user || !user.avatar_ext) return '';
    const ext = String(user.avatar_ext).toLowerCase();
    if (!EXTS.has(ext)) return '';
    return '/avatar/' + encodeURIComponent(String(user.id || '')) + '/' + ext;
}

// 磁盘上真实存在的扩展名，字段与文件冲突时以磁盘为准。
// 文件被删而字段还在时返回 ''，让渲染回退到首字而非破图
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
'use strict';

// 无图回退到「首字 + 颜色」
// 白名单须与 avatar.js 的 MAGIC 对齐
const EXTS = new Set(['png', 'jpg', 'gif', 'webp']);

// 只看字段，不查磁盘。
// uid 可显式传入：消息对象的 id 是消息主键，要用 user_id / from 才对
function avatarSrc(user, uid) {
    if (!user || !user.avatar_ext) return '';
    const ext = String(user.avatar_ext).toLowerCase();
    if (!EXTS.has(ext)) return '';
    const who = uid || user.id;
    if (!who) return '';
    return '/avatar/' + encodeURIComponent(String(who)) + '/' + ext;
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
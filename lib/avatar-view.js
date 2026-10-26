'use strict';
const EXTS = new Set(['png', 'jpg', 'gif', 'webp']);
function avatarSrc(user, uid) {
    if (!user || !user.avatar_ext) return '';
    const ext = String(user.avatar_ext).toLowerCase();
    if (!EXTS.has(ext)) return '';
    const who = uid || user.id;
    if (!who) return '';
    return '/avatar/' + encodeURIComponent(String(who)) + '/' + ext;
}
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

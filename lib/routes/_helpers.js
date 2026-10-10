'use strict';
const fs = require('fs');
const path = require('path');
const storage = require('../storage');
const auth = require('../auth');
const { PRIV, PERM, hasPriv, hasPerm } = require('../permissions');
const { UnauthorizedError } = require('../auth/privilege');

const ROOT = path.join(__dirname, '..', '..');

function redirect(res, url, extra) {
    res.writeHead(302, Object.assign({ Location: url }, extra || {}));
    res.end();
}

function deny401() {
    throw new UnauthorizedError();
}

function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

function getWsProtocol() {
    return (fs.existsSync(path.join(ROOT, 'cert.pem'))
         && fs.existsSync(path.join(ROOT, 'key.pem'))) ? 'wss' : 'ws';
}

function buildNav(user, domainName) {
    if (!user || !user.id) return { is_logged_in: false };
    const p = user.priv || 0;
    let unreadCount = 0;
    try { unreadCount = storage.getTotalUnread(user.id); } catch (e) {}
    const nav = {
        is_logged_in: true,
        is_superuser: hasPriv(p, PRIV.MANAGE_ALL_DOMAIN),
        is_system_admin: hasPriv(p, PRIV.MANAGE_SYSTEM),
        uid: user.id, nickname: user.nickname, avatar_color: user.avatar_color,
        can_manage_current: false,
        can_manage_system: hasPriv(p, PRIV.MANAGE_SYSTEM),
        can_manage_users: hasPriv(p, PRIV.MANAGE_USERS),
        can_create_domain: hasPriv(p, PRIV.CREATE_DOMAIN),
        can_send_dm: hasPriv(p, PRIV.SEND_DM),
        can_upload_file: hasPriv(p, PRIV.UPLOAD_FILE),
        can_revoke_own: false,
        can_revoke_any: false,
        is_member: false,
        join_policy: 'open',
        unread_count: unreadCount,
    };
    if (domainName && storage.domainExists(domainName)) {
        nav.can_manage_current = auth.canManageDomain(user, domainName);
        const du = auth.getDomainUser(domainName, user);
        const domain = storage.loadDomain(domainName);
        nav.is_member = !!du.is_member;
        nav.join_policy = domain.join_policy || 'open';
        nav.can_revoke_own = hasPerm(du.perm, PERM.REVOKE_OWN_MESSAGE);
        nav.can_revoke_any = hasPerm(du.perm, PERM.REVOKE_ANY_MESSAGE);
    }
    return nav;
}

function canEditDiscussion(du) {
    return hasPerm(du.perm, PERM.EDIT_DISCUSSION)
        || hasPerm(du.perm, PERM.MANAGE_DISCUSSION)
        || hasPerm(du.perm, PERM.MANAGE_USER);
}

function getFileIcon(mime) {
    if (!mime) return '📄';
    if (mime.startsWith('image/')) return '🖼';
    if (mime.startsWith('video/')) return '🎬';
    if (mime.startsWith('audio/')) return '🎵';
    if (mime.includes('zip') || mime.includes('tar')
        || mime.includes('rar') || mime.includes('7z')) return '📦';
    if (mime.includes('pdf')) return '📕';
    if (mime.includes('text/') || mime.includes('json')
        || mime.includes('javascript') || mime.includes('xml')) return '📝';
    if (mime.includes('word')) return '📘';
    if (mime.includes('excel') || mime.includes('sheet')) return '📗';
    if (mime.includes('msdownload') || mime.includes('x-msdos-program')
        || mime.includes('x-executable')) return '⚙';
    return '📄';
}

function formatSize(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatFileItem(meta) {
    return {
        id: meta.id,
        filename: meta.filename,
        mime: meta.mime,
        size: meta.size,
        size_str: formatSize(meta.size),
        icon: getFileIcon(meta.mime),
        uploader: meta.uploader || meta.owner,
        uploader_name: (storage.loadUser(meta.uploader || meta.owner) || {}).nickname || '?',
        created_at: meta.created_at || '',
        visibility: meta.visibility || 'private',
        is_own: false,
    };
}

function buildUserList(dn) {
    const domain = storage.loadDomain(dn);
    const users = [];
    const nowIso = storage.nowIso();

    if (domain.members) {
        for (const [uid, member] of Object.entries(domain.members)) {
            if (uid === storage.SYSTEM_UID) continue;
            const u = storage.loadUser(uid);
            if (!u.id) continue;
            users.push({
                id: uid, nickname: u.nickname || '?',
                avatar_color: u.avatar_color || '#888',
                level: member.level || 0, exp: member.exp || 0,
                role: member.role || 'default',
                muted_until: member.muted_until || '',
                is_owner: domain.owner_id === uid,
                is_superuser: hasPriv(u.priv || 0, PRIV.MANAGE_ALL_DOMAIN),
                is_admin: hasPriv(u.priv || 0, PRIV.MANAGE_SYSTEM),
                online: storage.isOnline(uid, dn),
                banned: false, ban_reason: '', ban_until: '',
            });
        }
    }

    if (domain.bans) {
        for (const [uid, ban] of Object.entries(domain.bans)) {
            if (uid === storage.SYSTEM_UID) continue;
            if (users.find(u => u.id === uid)) continue;
            if (ban.until && ban.until < nowIso) continue;
            const u = storage.loadUser(uid);
            if (!u.id) continue;
            users.push({
                id: uid, nickname: u.nickname || '?',
                avatar_color: u.avatar_color || '#888',
                level: 0, exp: 0, role: '(banned)',
                muted_until: '', is_owner: false,
                is_superuser: hasPriv(u.priv || 0, PRIV.MANAGE_ALL_DOMAIN),
                is_admin: hasPriv(u.priv || 0, PRIV.MANAGE_SYSTEM),
                online: false, banned: true,
                ban_reason: ban.reason || '',
                ban_until: ban.until || '',
            });
        }
    }

    users.sort((a, b) => {
        if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
        if (a.banned !== b.banned) return a.banned ? 1 : -1;
        if (a.online !== b.online) return a.online ? -1 : 1;
        if (a.exp !== b.exp) return b.exp - a.exp;
        return parseInt(b.id, 10) - parseInt(a.id, 10);
    });
    return users;
}

module.exports = {
    redirect, deny401, json, getWsProtocol,
    buildNav, canEditDiscussion,
    getFileIcon, formatSize, formatFileItem, buildUserList,
};

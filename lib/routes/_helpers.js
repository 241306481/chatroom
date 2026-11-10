'use strict';
function limitMessage(what, limited) {
    const left = limited.leftSec || 0;
    let wait;
    if (left >= 60) {
        const m = Math.ceil(left / 60);
        wait = m + ' 分钟后';
    } else {
        wait = left + ' 秒后';
    }
    const reason = limited.dim === 'ip'
        ? '当前 IP 触发频率限制'
        : '该账号触发频率限制';
    return what + '过于频繁：' + reason + '，请 ' + wait + '重试';
}
const storage = require('../storage');
const auth = require('../auth');
const { isUserBannedInDomain } = require('../auth/checks');
const { PRIV, PERM, hasPriv, hasPerm } = require('../permissions');
const { formatSize } = require('../format');
const { isUntilActive } = require('../until');
function redirect(res, url, extra) {
    res.writeHead(302, Object.assign({ Location: url }, extra || {}));
    res.end();
}
function json(res, code, obj, extra) {
    res.writeHead(code, Object.assign(
        { 'Content-Type': 'application/json; charset=utf-8' }, extra || {}));
    res.end(JSON.stringify(obj));
}
function formError(res, message, code) {
    return json(res, code || 200, { ok: false, error: message || '操作失败' });
}
function buildNav(user, domainName) {
    if (!user || !user.id) return { is_logged_in: false };
    let unreadCount = 0;
    try { unreadCount = storage.getTotalUnread(user.id); } catch (e) {}
    const nav = {
        is_logged_in: true,
        is_superuser: hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL),
        is_system_admin: hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL),
        uid: user.id, nickname: user.nickname, avatar_color: user.avatar_color,
        avatar_ext: user.avatar_ext || '',
        can_manage_current: false,
        can_manage_system: hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL),
        can_manage_users: hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_USERS),
        can_create_domain: hasPriv(user, 'base', PRIV.BASE.CREATE_DOMAIN),
        can_send_dm: hasPriv(user, 'base', PRIV.BASE.SEND_DM),
        can_upload_file: hasPriv(user, 'base', PRIV.BASE.UPLOAD_FILE),
        can_revoke_own: false,
        can_revoke_any: false,
        is_member: false,
        join_policy: 'open',
        unread_count: unreadCount,
    };
    if (domainName && storage.domainExists(domainName)) {
        const domain = storage.loadDomain(domainName);
        const du = auth.getDomainUser(domainName, user, false, domain);
        nav.can_manage_current = hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)
            || hasPerm(du.perm, PERM.MANAGE.USER)
            || hasPerm(du.perm, PERM.MANAGE.ROLE)
            || hasPerm(du.perm, PERM.GENERAL.EDIT_DOMAIN)
            || hasPerm(du.perm, PERM.DISCUSS.MANAGE);
        nav.is_member = !!du.is_member;
        nav.join_policy = domain.join_policy || 'open';
        nav.can_revoke_own = hasPerm(du.perm, PERM.MESSAGE.REVOKE_OWN)
            && hasPriv(user, 'message', PRIV.MESSAGE.REVOKE_OWN);
        nav.can_revoke_any = hasPerm(du.perm, PERM.MESSAGE.REVOKE_ANY)
            && hasPriv(user, 'message', PRIV.MESSAGE.REVOKE_ANY);
    }
    return nav;
}
function canEditDiscussion(du) {
    return hasPerm(du.perm, PERM.DISCUSS.EDIT)
        || hasPerm(du.perm, PERM.DISCUSS.MANAGE)
        || hasPerm(du.perm, PERM.MANAGE.USER);
}
function getFileIcon(mime) {
    if (!mime) return '📄';
    if (mime.startsWith('image/')) return '🖼️';
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
        || mime.includes('x-executable')) return '⚙️';
    return '📄';
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
        pinned: !!meta.pinned,
        is_own: false,
    };
}
function buildDiscussFileView(dn, disc, meta) {
    const url = `/domain/${encodeURIComponent(dn)}/discuss/`
        + `${encodeURIComponent(disc)}/file/${encodeURIComponent(meta.id)}`;
    return Object.assign(formatFileItem(meta), {
        url, download_url: url + '/download',
    });
}
function buildDMFileView(uid1, uid2, meta) {
    const url = `/messages/file/${encodeURIComponent(uid1)}/`
        + `${encodeURIComponent(uid2)}/${encodeURIComponent(meta.id)}`;
    return Object.assign(formatFileItem(meta), {
        url, download_url: url + '/download',
    });
}
function buildUserList(dn) {
    const domain = storage.loadDomain(dn);
    const users = [];
    const seen = new Set();
    const nowIso = storage.nowIso();
    if (domain.members) {
        for (const [uid, member] of Object.entries(domain.members)) {
            if (uid === storage.SYSTEM_UID) continue;
            const u = storage.loadUser(uid);
            if (!u.id) continue;
            seen.add(uid);
            users.push({
                id: uid, nickname: u.nickname || '?',
                avatar_color: u.avatar_color || '#888', avatar_ext: u.avatar_ext || '',
                level: member.level || 0, exp: member.exp || 0,
                role: member.role || 'default',
                muted_until: member.muted_until || '',
                is_owner: domain.owner_id === uid,
                is_superuser: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_ALL),
                is_admin: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_PANEL),
                online: storage.isOnline(uid, dn),
                banned: isUserBannedInDomain(domain, uid),
                ban_reason: '', ban_until: '',
            });
        }
    }
    if (domain.bans) {
        for (const [uid, ban] of Object.entries(domain.bans)) {
            if (uid === storage.SYSTEM_UID) continue;
            if (seen.has(uid)) continue;
            if (!isUntilActive(ban.until, nowIso)) continue;
            const u = storage.loadUser(uid);
            if (!u.id) continue;
            seen.add(uid);
            users.push({
                id: uid, nickname: u.nickname || '?',
avatar_color: u.avatar_color || '#888', avatar_ext: u.avatar_ext || '',
            level: 0, exp: 0, role: '(banned)',
                muted_until: '', is_owner: false,
                is_superuser: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_ALL),
                is_admin: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_PANEL),
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
    limitMessage,
    redirect, json, formError,
    buildNav, canEditDiscussion,
    getFileIcon, formatSize, formatFileItem, buildUserList,
    buildDiscussFileView, buildDMFileView,
};

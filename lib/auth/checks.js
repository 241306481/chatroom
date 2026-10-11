'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');

// ============================================================
// 全局封禁检查
// ============================================================
function isUserBanned(user) {
    if (!user || !user.banned) return false;
    if (!user.banned_until) return true;
    return user.banned_until > storage.nowIso();
}

// ============================================================
// 域封禁检查（纯读）
// ============================================================
function isUserBannedInDomain(domain, uid) {
    if (!domain || !domain.bans || !domain.bans[uid]) return false;
    const b = domain.bans[uid];
    if (!b.until) return true;
    return b.until > storage.nowIso();
}

// ============================================================
// 所有者判断（跨域）
// ============================================================
function isOwnerOfAnyDomain(uid) {
    if (!uid) return false;
    for (const dn of storage.listAllDomains()) {
        const d = storage.loadDomain(dn);
        if (d.owner_id === uid) return true;
    }
    return false;
}

// ============================================================
// 踢人 / 改角色前置检查
// ============================================================
function canKickUser(actor, domainName, targetUid) {
    const domain = storage.loadDomain(domainName);
    if (!domain.name) return { ok: false, error: '域不存在' };
    if (domainName === 'system') return { ok: false, error: 'system 域成员不可被踢出' };
    if (domain.owner_id === targetUid) return { ok: false, error: '所有者不可被踢出' };

    const target = storage.loadUser(targetUid);
    if (hasPriv(target.priv || 0, PRIV.MANAGE_ALL_DOMAIN)) {
        return { ok: false, error: '超级管理员不可被踢出' };
    }
    if (hasPriv(target.priv || 0, PRIV.MANAGE_SYSTEM)
        && !(actor && hasPriv(actor.priv || 0, PRIV.MANAGE_ALL_DOMAIN))) {
        return { ok: false, error: '系统管理员不能被系统管理员踢出' };
    }

    // 目标若是该域的管理员：只有所有者能踢
    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            return { ok: false, error: '只有所有者能移除管理员' };
        }
    }

    // 目标若是其他域的所有者：只有全局超管能踢
    if (isOwnerOfAnyDomain(targetUid)
        && (!actor || !hasPriv(actor.priv || 0, PRIV.MANAGE_ALL_DOMAIN))) {
        return { ok: false, error: '该用户是某个域的所有者' };
    }

    if (actor && actor.id === targetUid) return { ok: false, error: '不能踢出自己' };
    return { ok: true };
}

function canChangeRole(actor, domainName, targetUid) {
    const domain = storage.loadDomain(domainName);
    if (!domain.name) return { ok: false, error: '域不存在' };
    if (domain.owner_id === targetUid) return { ok: false, error: '所有者的角色不可更改' };

    const target = storage.loadUser(targetUid);
    if (hasPriv(target.priv || 0, PRIV.MANAGE_ALL_DOMAIN)
        && (!actor || actor.id !== targetUid)) {
        return { ok: false, error: '超级管理员的角色不可更改' };
    }
    if (hasPriv(target.priv || 0, PRIV.MANAGE_SYSTEM)
        && (!actor || !hasPriv(actor.priv || 0, PRIV.MANAGE_ALL_DOMAIN))) {
        return { ok: false, error: '系统管理员不能被系统管理员改角色' };
    }

    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            return { ok: false, error: '只有所有者能调整管理员的角色' };
        }
    }

    if (isOwnerOfAnyDomain(targetUid)
        && (!actor || !hasPriv(actor.priv || 0, PRIV.MANAGE_ALL_DOMAIN))) {
        return { ok: false, error: '该用户是某个域的所有者' };
    }
    return { ok: true };
}

module.exports = {
    isUserBanned, isUserBannedInDomain, isOwnerOfAnyDomain,
    canKickUser, canChangeRole,
};
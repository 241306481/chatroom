'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');
const { isUntilActive } = require('../until');

// 全局封禁检查
function isUserBanned(user) {
    if (!user || !user.banned) return false;
    return isUntilActive(user.banned_until);
}

// 域封禁检查
function isUserBannedInDomain(domain, uid) {
    if (!domain || !domain.bans || !domain.bans[uid]) return false;
    return isUntilActive(domain.bans[uid].until);
}

// 所有者判断
function isOwnerOfAnyDomain(uid) {
    if (!uid) return false;
    for (const dn of storage.listAllDomains()) {
        const d = storage.loadDomain(dn);
        if (d.owner_id === uid) return true;
    }
    return false;
}

// 踢人与改角色检查
function canKickUser(actor, domainName, targetUid) {
    const domain = storage.loadDomain(domainName);
    if (!domain.name) return { ok: false, error: '域不存在' };
    if (domainName === 'system') return { ok: false, error: 'system 域成员不可被踢出' };
    if (domain.owner_id === targetUid) return { ok: false, error: '所有者不可被踢出' };

    const target = storage.loadUser(targetUid);
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
        return { ok: false, error: '超级管理员不可被踢出' };
    }
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL)
        && !(actor && hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        return { ok: false, error: '系统管理员不能被系统管理员踢出' };
    }

    // 域内管理员限所有者
    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            return { ok: false, error: '只有所有者能移除管理员' };
        }
    }

    // 他域所有者仅超管可踢
    if (isOwnerOfAnyDomain(targetUid)
        && (!actor || !hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
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
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL)
        && (!actor || actor.id !== targetUid)) {
        return { ok: false, error: '超级管理员的角色不可更改' };
    }
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL)
        && !(actor && hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        return { ok: false, error: '系统管理员不能被系统管理员改角色' };
    }

    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            return { ok: false, error: '只有所有者能调整管理员的角色' };
        }
    }

    if (isOwnerOfAnyDomain(targetUid)
        && (!actor || !hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        return { ok: false, error: '该用户是某个域的所有者' };
    }
    return { ok: true };
}

/**
 * 授予某角色前的检查。与 canChangeRole 分开，
 * 因为「修改 root 的角色」和「把别人提升为 root」是两种不同的风险。
 */
function canGrantRole(actor, domainName, targetUid, roleName) {
    const base = canChangeRole(actor, domainName, targetUid);
    if (!base.ok) return base;

    if (!roleName || roleName === 'root') {
        // root 限超管
        const domain = storage.loadDomain(domainName);
        const isOwner = actor && domain.owner_id === actor.id;
        const isSuper = actor && hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL);
        if (!isOwner && !isSuper) {
            return { ok: false, error: '只有域所有者或超级管理员可以授予管理员角色' };
        }
    }
    return { ok: true };
}

/**
 * 禁言前的目标安全检查。
 * 禁言不需要踢人那么强，但至少不能作用在域主和域内 root 管理员身上。
 */
function canMuteUser(actor, domainName, targetUid) {
    const domain = storage.loadDomain(domainName);
    if (!domain.name) return { ok: false, error: '域不存在' };
    if (domain.owner_id === targetUid) return { ok: false, error: '所有者不可被禁言' };

    if (actor && actor.id === targetUid) {
        return { ok: false, error: '不能禁言自己' };
    }

    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            return { ok: false, error: '只有所有者能禁言管理员' };
        }
    }
    return { ok: true };
}

module.exports = {
    isUserBanned, isUserBannedInDomain, isOwnerOfAnyDomain,
    canKickUser, canChangeRole, canGrantRole, canMuteUser,
};
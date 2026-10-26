'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');
const { isUntilActive } = require('../until');
function isUserBanned(user) {
    if (!user || !user.banned) return false;
    return isUntilActive(user.banned_until);
}
function isUserBannedInDomain(domain, uid) {
    if (!domain || !domain.bans || !domain.bans[uid]) return false;
    return isUntilActive(domain.bans[uid].until);
}
function isOwnerOfAnyDomain(uid) {
    if (!uid) return false;
    for (const dn of storage.listAllDomains()) {
        const d = storage.loadDomain(dn);
        if (d.owner_id === uid) return true;
    }
    return false;
}
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
    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            return { ok: false, error: '只有所有者能移除管理员' };
        }
    }
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
function canGrantRole(actor, domainName, targetUid, roleName) {
    const base = canChangeRole(actor, domainName, targetUid);
    if (!base.ok) return base;
    if (!roleName || roleName === 'root') {
        const domain = storage.loadDomain(domainName);
        const isOwner = actor && domain.owner_id === actor.id;
        const isSuper = actor && hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL);
        if (!isOwner && !isSuper) {
            return { ok: false, error: '只有域所有者或超级管理员可以授予管理员角色' };
        }
    }
    return { ok: true };
}
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

'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');
const { isOwnerOfAnyDomain } = require('./checks');
const { sendSystemDM } = require('./system-dm');

// ============================================================
// 全局封禁
// ============================================================
function banUserGlobally(targetUid, reason, untilIso, byUid) {
    const target = storage.loadUser(targetUid);
    if (!target.id) throw new Error('用户不存在');
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
        throw new Error('不能封禁超级管理员');
    }
    const actorUser = byUid ? storage.loadUser(byUid) : null;
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL)
        && !(actorUser && hasPriv(actorUser, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        throw new Error('系统管理员不能被系统管理员封禁');
    }
    target.banned = true;
    target.ban_reason = storage.sliceChars(reason, 200);
    target.banned_until = untilIso || '';
    target.banned_by = byUid;
    target.banned_at = storage.nowIso();
    storage.saveUser(targetUid, target);
}

function unbanUserGlobally(targetUid) {
    const target = storage.loadUser(targetUid);
    if (!target.id) throw new Error('用户不存在');
    delete target.banned;
    delete target.ban_reason;
    delete target.banned_until;
    delete target.banned_by;
    delete target.banned_at;
    storage.saveUser(targetUid, target);
}

// ============================================================
// 系统管理员
// ============================================================
function setSystemRole(targetUid, roleName) {
    const target = storage.loadUser(targetUid);
    if (!target.id) throw new Error('用户不存在');
    if (target.is_system) throw new Error('不能修改系统账户');

    const sysRoles = require('../storage/system-roles');
    if (!sysRoles.roleExists(roleName)) throw new Error('角色不存在');

    // 不能把普通用户升级为 root
    if (roleName === 'root' && target.system_role !== 'root') {
        throw new Error('不能把用户升级为超级管理员');
    }

    // 不能降级 root
    if (target.system_role === 'root' && roleName !== 'root') {
        throw new Error('超级管理员不可被降级');
    }

    target.system_role = roleName;
    storage.saveUser(targetUid, target);
}

// ============================================================
// 域封禁
// ============================================================
function banUserInDomain(dn, targetUid, reason, untilIso, actor) {
    const domain = storage.loadDomain(dn);
    if (!domain.name) throw new Error('域不存在');
    if (domain.owner_id === targetUid) throw new Error('不能封禁所有者');

    const target = storage.loadUser(targetUid);
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
        throw new Error('不能封禁超级管理员');
    }
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL)
        && !(actor && hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        throw new Error('系统管理员不能被系统管理员封禁');
    }

    // 目标若是该域其他管理员
    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            throw new Error('只有所有者能封禁管理员');
        }
    }

    // 目标若是其他域的所有者
    if (isOwnerOfAnyDomain(targetUid)
        && (!actor || !hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        throw new Error('该用户是某个域的所有者');
    }

    if (!domain.bans) domain.bans = {};
    domain.bans[targetUid] = {
        reason: storage.sliceChars(reason, 200),
        until: untilIso || '',
        by: (actor && actor.id) || '',
        at: storage.nowIso(),
    };
    if (domain.members && domain.members[targetUid]) {
        delete domain.members[targetUid];
    }
    storage.saveDomain(dn, domain);
}

function unbanUserInDomain(dn, targetUid) {
    const domain = storage.loadDomain(dn);
    if (!domain.bans || !domain.bans[targetUid]) return;
    delete domain.bans[targetUid];
    storage.saveDomain(dn, domain);
}

module.exports = {
    banUserGlobally, unbanUserGlobally,
    setSystemRole,
    banUserInDomain, unbanUserInDomain,
};
'use strict';
const storage = require('../storage');
const { PRIV, BUILTIN_ROLES, hasPriv } = require('../permissions');
const { canMuteUser } = require('./checks');
const { sendSystemDM } = require('./system-dm');
const { isUserBannedInDomain } = require('./checks');
function ensureMember(domain, uid) {
    if (!domain.members || typeof domain.members !== 'object'
        || Array.isArray(domain.members)) {
        domain.members = {};
    }
    const cur = domain.members[uid];
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) return;
    domain.members[uid] = {
        role: 'default', level: 0, exp: 0, joined_at: storage.nowIso(),
    };
}
function grantRole(dn, uid, roleName) {
    if (!dn || !uid || !roleName) throw new Error('参数不完整');
    const domain = storage.loadDomain(dn);
    if (!domain.name) throw new Error('域不存在');
    if (!uid || uid === storage.SYSTEM_UID) throw new Error('不能授予该用户角色');
    if (!storage.loadUser(uid).id) throw new Error('用户不存在');
    if (isUserBannedInDomain(domain, uid)) {
        throw new Error('该用户已被本域封禁，请先解封');
    }
    ensureMember(domain, uid);
    const old = domain.members[uid].role || 'default';
    domain.members[uid].role = roleName;
    storage.saveDomain(dn, domain);
    if (old !== roleName) {
        const dn2 = domain.display_name || dn;
        const roleDisplay = (BUILTIN_ROLES[roleName] && BUILTIN_ROLES[roleName].display)
            || (domain.roles && domain.roles[roleName] && domain.roles[roleName].display)
            || roleName;
        try { sendSystemDM(uid, `你在「${dn2}」的角色已变更为「${roleDisplay}」`); } catch (e) {}
    }
}
function muteUser(dn, uid, untilIso, actor) {
    if (actor) {
        const c = canMuteUser(actor, dn, uid);
        if (!c.ok) throw new Error(c.error);
    }
    const domain = storage.loadDomain(dn);
    const member = domain.members && domain.members[uid];
    if (member && typeof member === 'object' && !Array.isArray(member)) {
        const mu = require('../until').normalizeUntil(untilIso);
        if (mu === null) throw new Error('解禁时间无效，应为 2026-06-01T12:00 或 2026-06-01T12:00:00Z');
        member.muted_until = mu;
        storage.saveDomain(dn, domain);
        try { sendSystemDM(uid, `你在「${domain.display_name || dn}」被禁言至 ${untilIso}`); } catch (e) {}
    }
}
function unmuteUser(dn, uid) {
    const domain = storage.loadDomain(dn);
    const member = domain.members && domain.members[uid];
    if (member && typeof member === 'object' && !Array.isArray(member)) {
        member.muted_until = '';
        storage.saveDomain(dn, domain);
        try { sendSystemDM(uid, `你在「${domain.display_name || dn}」的禁言已解除`); } catch (e) {}
    }
}
function kickUser(dn, uid) {
    const domain = storage.loadDomain(dn);
    if (domain.members && domain.members[uid]) {
        delete domain.members[uid];
        storage.saveDomain(dn, domain);
        try { sendSystemDM(uid, `你已被移出「${domain.display_name || dn}」`); } catch (e) {}
    }
}
function transferDomain(dn, targetUid, actor) {
    const domain = storage.loadDomain(dn);
    if (!domain.name) throw new Error('域不存在');
    if (!domain.members || !domain.members[targetUid]) {
        throw new Error('目标用户不在该域中');
    }
    if (targetUid === domain.owner_id) throw new Error('目标已是所有者');
    const target = storage.loadUser(targetUid);
    if (!target.id) throw new Error('目标用户不存在');
    const isActorOwner = actor && domain.owner_id === actor.id;
    const isActorSuper = actor && hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL);
    if (!isActorOwner && !isActorSuper) {
        throw new Error('只有所有者或超级管理员可以转让');
    }
    const oldOwner = domain.owner_id;
    domain.owner_id = targetUid;
    if (!domain.members[targetUid]) domain.members[targetUid] = {};
    domain.members[targetUid].role = 'root';
    if (domain.members[oldOwner]) domain.members[oldOwner].role = 'root';
    storage.saveDomain(dn, domain);
    const dn2 = domain.display_name || dn;
    try { sendSystemDM(targetUid, `你已成为「${dn2}」的所有者`); } catch (e) {}
    if (oldOwner && oldOwner !== targetUid) {
        try { sendSystemDM(oldOwner, `你已转让「${dn2}」的所有权，现为管理员`); } catch (e) {}
    }
    return { oldOwner, newOwner: targetUid };
}
module.exports = {
    ensureMember, grantRole, muteUser, unmuteUser, kickUser, transferDomain,
};

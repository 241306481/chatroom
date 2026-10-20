'use strict';
const storage = require('../storage');
const { PRIV, PERM, BUILTIN_ROLES, hasPriv, hasPerm, ADMIN_LEVEL } = require('../permissions');
const { isUserBannedInDomain } = require('./checks');
const { isMuteActive } = require('../until');

// 角色权限解析（域级）
function resolveRolePerm(domainName, roleName) {
    const builtin = BUILTIN_ROLES[roleName];
    if (builtin) {
        if (builtin.editable) {
            const domain = storage.loadDomain(domainName);
            if (domain.perm_overrides && domain.perm_overrides[roleName] !== undefined) {
                return domain.perm_overrides[roleName];
            }
        }
        return builtin.perm;
    }
    const domain = storage.loadDomain(domainName);
    if (domain.roles && domain.roles[roleName]) return domain.roles[roleName].perm || 0;
    return 0;
}

// 域内用户解析

function markPrivileged(du, user) {
    du.is_privileged = !!(
        du.is_owner
        || du.role === 'root'
        || (user && hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL))
        || (user && hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL))
        || (user && hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_DOMAINS))
    );
    return du;
}

function getDomainUser(domainName, user, forceReload) {
    const du = {
        role: 'guest', perm: { hi: 0, lo: 0 }, is_member: false,
        is_muted: false, muted_until: '', level: 0, exp: 0,
        is_owner: false, is_system: false,
        is_privileged: false,
    };

    if (user && user.id === storage.SYSTEM_UID) {
        du.role = 'root'; du.perm = PERM.ALL; du.level = ADMIN_LEVEL;
        du.is_member = true; du.is_system = true;
        return markPrivileged(du, user);
    }

    if (!user || !user.id) {
        du.role = 'guest'; du.perm = resolveRolePerm(domainName, 'guest');
        return markPrivileged(du, user);
    }

    if (!hasPriv(user, 'base', PRIV.BASE.USER_PROFILE)) {
        du.role = 'guest'; du.perm = resolveRolePerm(domainName, 'guest');
        return markPrivileged(du, user);
    }

    const domain = storage.loadDomain(domainName);
    du.is_owner = domain.owner_id === user.id;

    // 域封禁降 guest
    if (isUserBannedInDomain(domain, user.id)) {
        du.role = 'guest';
        du.perm = resolveRolePerm(domainName, 'guest');
        return markPrivileged(du, user);
    }

    const isMember = !!(domain.members && domain.members[user.id]);
    du.is_member = isMember;
    if (!isMember && !hasPriv(user, 'base', PRIV.BASE.VIEW_ALL_DOMAIN)) {
        du.role = 'guest'; du.perm = resolveRolePerm(domainName, 'guest');
        return markPrivileged(du, user);
    }

    // 1. 全局超管
    if (hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
        du.role = du.is_owner ? 'owner' : 'root';
        du.perm = PERM.ALL; du.level = ADMIN_LEVEL;
        return markPrivileged(du, user);
    }

    // 2. 系统管理员
    if (hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        du.role = du.is_owner ? 'owner' : 'root';
        du.perm = PERM.ALL; du.level = ADMIN_LEVEL;
        return markPrivileged(du, user);
    }

    if (hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_DOMAINS)) {
        du.role = du.is_owner ? 'owner' : 'admin';
        du.perm = PERM.ALL;
        return markPrivileged(du, user);
    }

    // 4. 所有者
    if (du.is_owner) {
        du.role = 'owner';
        du.perm = PERM.ALL; du.level = ADMIN_LEVEL;
        return markPrivileged(du, user);
    }

    // 5. 按角色
    let roleName = 'default';
    if (isMember) {
        const m = domain.members[user.id];
        roleName = m.role || 'default';
        du.level = m.level || 0;
        du.exp = m.exp || 0;
        const mu = m.muted_until || '';
        // 用 Mute 判定
        if (isMuteActive(mu)) { du.is_muted = true; du.muted_until = mu; }
    }
    du.role = roleName;
    du.perm = resolveRolePerm(domainName, roleName);
    return markPrivileged(du, user);
}

// 是否可管理某域
function canManageDomain(user, dn) {
    if (!user || !user.id) return false;
    if (hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)) return true;
    const du = getDomainUser(dn, user);
    return hasPerm(du.perm, PERM.MANAGE_USER)
        || hasPerm(du.perm, PERM.MANAGE_ROLE)
        || hasPerm(du.perm, PERM.EDIT_DOMAIN)
        || hasPerm(du.perm, PERM.MANAGE_DISCUSSION);
}

module.exports = { resolveRolePerm, getDomainUser, canManageDomain };
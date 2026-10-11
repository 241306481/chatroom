'use strict';
const storage = require('../storage');
const { PRIV, PERM, BUILTIN_ROLES, hasPriv, hasPerm } = require('../permissions');
const { isUserBannedInDomain } = require('./checks');

// ============================================================
// 角色权限解析（域级）
// ============================================================
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

// ============================================================
// 域内用户解析
// ============================================================
function getDomainUser(domainName, user, forceReload) {
    const du = {
        role: 'guest', perm: 0, is_member: false,
        is_muted: false, muted_until: '', level: 0, exp: 0,
        is_owner: false, is_system: false,
    };

    if (user && user.id === storage.SYSTEM_UID) {
        du.role = 'root'; du.perm = PERM.ALL; du.level = 99;
        du.is_member = true; du.is_system = true;
        return du;
    }

    if (!user || !user.id) {
        du.role = 'guest'; du.perm = resolveRolePerm(domainName, 'guest');
        return du;
    }

    if (!hasPriv(user, 'base', PRIV.BASE.USER_PROFILE)) {
        du.role = 'guest'; du.perm = resolveRolePerm(domainName, 'guest');
        return du;
    }

    const domain = storage.loadDomain(domainName);
    du.is_owner = domain.owner_id === user.id;

    // 域封禁 → 降为 guest
    if (isUserBannedInDomain(domain, user.id)) {
        du.role = 'guest';
        du.perm = resolveRolePerm(domainName, 'guest');
        return du;
    }

    const isMember = !!(domain.members && domain.members[user.id]);
    du.is_member = isMember;
    if (!isMember && !hasPriv(user, 'base', PRIV.BASE.VIEW_ALL_DOMAIN)) {
        du.role = 'guest'; du.perm = resolveRolePerm(domainName, 'guest');
        return du;
    }

    // 1. 全局超管
    if (hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
        du.role = du.is_owner ? 'owner' : 'root';
        du.perm = PERM.ALL; du.level = 99;
        return du;
    }

    // 2. 系统管理员
    if (hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        du.role = du.is_owner ? 'owner' : 'root';
        du.perm = PERM.ALL; du.level = 99;
        return du;
    }

    // 3. 所有者
    if (du.is_owner) {
        du.role = 'owner';
        du.perm = PERM.ALL; du.level = 99;
        return du;
    }

    // 4. 按角色
    let roleName = 'default';
    if (isMember) {
        const m = domain.members[user.id];
        roleName = m.role || 'default';
        du.level = m.level || 0;
        du.exp = m.exp || 0;
        const mu = m.muted_until || '';
        if (mu && mu > storage.nowIso()) { du.is_muted = true; du.muted_until = mu; }
    }
    du.role = roleName;
    du.perm = resolveRolePerm(domainName, roleName);
    return du;
}

// ============================================================
// 是否可管理某域
// ============================================================
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
'use strict';
const { PRIV, hasPriv } = require('../../permissions');
const { UnauthorizedError } = require('../../auth/privilege');
const { render403 } = require('../../template');

// 页面用途 -> 需要的系统权限位。缺省仍要 MANAGE_PANEL
const PAGE_BITS = {
    settings: PRIV.SYSTEM.EDIT_SETTINGS,
    users: PRIV.SYSTEM.MANAGE_USERS,
    system_roles: PRIV.SYSTEM.MANAGE_SYS_ROLES,
    permissions: PRIV.SYSTEM.MANAGE_SYS_PERMS,
    ip_bans: PRIV.SYSTEM.MANAGE_IP_BANS,
    user_ips: PRIV.SYSTEM.MANAGE_PANEL,
    join_applications: PRIV.SYSTEM.MANAGE_DOMAINS,
};

// 超级管理员持有 MANAGE_ALL，直接放行
function hasSystemBit(user, bit) {
    return hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)
        || hasPriv(user, 'system', bit);
}

function requireSystemAdmin(user, res, page) {
    if (!user || !user.id) {
        throw new UnauthorizedError();
    }
    const bit = PAGE_BITS[page] || PRIV.SYSTEM.MANAGE_PANEL;
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL) && !hasSystemBit(user, bit)) {
        render403(res, '仅系统管理员可访问');
        return false;
    }
    return true;
}

module.exports = { requireSystemAdmin, hasSystemBit, PAGE_BITS };
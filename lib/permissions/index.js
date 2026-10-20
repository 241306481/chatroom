'use strict';
// index 再导出
'use strict';
const priv = require('./priv');
const perm = require('./perm');
const roles = require('./roles');
const dualCheck = require('./dual-check');

module.exports = {
    // 用户级
    PRIV: priv.PRIV,
    PRIV_ALL: priv.PRIV_ALL,
    PRIV_GROUPS: priv.PRIV_GROUPS,
    makePrivAll: priv.makePrivAll,
    hasPriv: priv.hasPriv,
    hasPrivAny: priv.hasPrivAny,
    // 域级
    PERM: perm.PERM,
    PERM_NAMES: perm.PERM_NAMES,
    PERM_IMPLIES: perm.PERM_IMPLIES,
    expandPerm: perm.expandPerm,
    hasPerm: perm.hasPerm,
    bits: perm.bits,
    // 角色
    BUILTIN_ROLES: roles.BUILTIN_ROLES,
    SYSTEM_ROLES_BUILTIN: roles.SYSTEM_ROLES_BUILTIN,
    // 双检
    DUAL_CHECK: dualCheck.DUAL_CHECK,
    isScopedDual: dualCheck.isScopedDual,
    ADMIN_LEVEL: dualCheck.ADMIN_LEVEL,
};


'use strict';
'use strict';
const priv = require('./priv');
const perm = require('./perm');
const roles = require('./roles');
const dualCheck = require('./dual-check');
module.exports = {
    PRIV: priv.PRIV,
    PRIV_ALL: priv.PRIV_ALL,
    PRIV_GROUPS: priv.PRIV_GROUPS,
    makePrivAll: priv.makePrivAll,
    hasPriv: priv.hasPriv,
    hasPrivAny: priv.hasPrivAny,
    PERM: perm.PERM,
    PERM_NAMES: perm.PERM_NAMES,
    PERM_IMPLIES: perm.PERM_IMPLIES,
    expandPerm: perm.expandPerm,
    hasPerm: perm.hasPerm,
    bits: perm.bits,
    BUILTIN_ROLES: roles.BUILTIN_ROLES,
    SYSTEM_ROLES_BUILTIN: roles.SYSTEM_ROLES_BUILTIN,
    DUAL_CHECK: dualCheck.DUAL_CHECK,
    isScopedDual: dualCheck.isScopedDual,
    ADMIN_LEVEL: dualCheck.ADMIN_LEVEL,
};

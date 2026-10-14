'use strict';
// 本文件是 lib/permissions/ 的组成部分，由 index.js 统一再导出。
'use strict';
// 权限体系统一出口。
//
// 原本是单个 600+ 行文件，其中 90% 是位表数据。现在拆成：
//   priv.js       用户级 PRIV 位（全局开关）
//   perm.js       域级 PERM 位（域内开关）
//   roles.js      内置角色定义
//   dual-check.js PRIV × PERM 的双检映射
//
// 调用方一律继续 require('../permissions')，无需改动。
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
    // 角色
    BUILTIN_ROLES: roles.BUILTIN_ROLES,
    SYSTEM_ROLES_BUILTIN: roles.SYSTEM_ROLES_BUILTIN,
    // 双检
    DUAL_CHECK: dualCheck.DUAL_CHECK,
    isScopedDual: dualCheck.isScopedDual,
    ADMIN_LEVEL: dualCheck.ADMIN_LEVEL,
};


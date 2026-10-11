'use strict';
const storage = require('./index');
const { SYSTEM_ROLES_BUILTIN, PRIV } = require('../permissions');

let _cache = null;
let _cacheAt = 0;
const TTL = 60 * 1000;

function loadRoles() {
    const now = Date.now();
    if (_cache && now - _cacheAt < TTL) return _cache;
    const sysDomain = storage.loadDomain('system') || {};
    const overrides = sysDomain.system_role_privs || {};
    const custom = sysDomain.system_roles || {};

    const all = {};

    // 内置角色
    for (const [name, role] of Object.entries(SYSTEM_ROLES_BUILTIN)) {
        let priv = role.priv;
        if (role.editable && overrides[name] !== undefined) {
            priv = overrides[name];
        }
        all[name] = {
            display: role.display,
            editable: role.editable,
            builtin: true,
            priv: priv,
        };
    }

    // 自定义角色
    for (const [name, role] of Object.entries(custom)) {
        all[name] = {
            display: role.display || name,
            editable: true,
            builtin: false,
            priv: role.priv || 0,
        };
    }

    _cache = all;
    _cacheAt = now;
    return all;
}

function invalidateCache() { _cache = null; _cacheAt = 0; }

// 保存角色 priv
// - 内置可编辑角色 → system_role_privs
// - 自定义角色 → system_roles[name].priv
function saveRolePriv(roleName, priv) {
    const sysDomain = storage.loadDomain('system');
    const builtin = SYSTEM_ROLES_BUILTIN[roleName];
    if (builtin) {
        if (!builtin.editable) return;
        if (!sysDomain.system_role_privs) sysDomain.system_role_privs = {};
        sysDomain.system_role_privs[roleName] = priv;
    } else {
        if (!sysDomain.system_roles) sysDomain.system_roles = {};
        if (!sysDomain.system_roles[roleName]) {
            sysDomain.system_roles[roleName] = { display: roleName, priv: 0 };
        }
        sysDomain.system_roles[roleName].priv = priv;
    }
    storage.saveDomain('system', sysDomain);
    invalidateCache();
}

function createRole(name, display) {
    const sysDomain = storage.loadDomain('system');
    if (!sysDomain.system_roles) sysDomain.system_roles = {};
    sysDomain.system_roles[name] = { display: display || name, priv: 0 };
    storage.saveDomain('system', sysDomain);
    invalidateCache();
}

function deleteRole(name) {
    const sysDomain = storage.loadDomain('system');
    if (!sysDomain.system_roles || !sysDomain.system_roles[name]) return;
    delete sysDomain.system_roles[name];
    storage.saveDomain('system', sysDomain);
    invalidateCache();
}

function getRolePriv(roleName) {
    try {
        const roles = loadRoles();
        if (roles[roleName]) return roles[roleName].priv || 0;
    } catch (e) {}
    return PRIV.USER_PROFILE;
}

function roleExists(roleName) {
    return !!loadRoles()[roleName];
}

module.exports = {
    loadRoles, invalidateCache, saveRolePriv,
    createRole, deleteRole, getRolePriv, roleExists,
};
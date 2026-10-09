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
    const builtin = SYSTEM_ROLES_BUILTIN || {};
    const all = {};
    for (const [name, role] of Object.entries(builtin)) {
        all[name] = {
            display: role.display,
            editable: role.editable,
            builtin: true,
            priv: (role.editable && overrides[name] !== undefined)
                ? overrides[name]
                : (role.priv || 0),
        };
    }
    const custom = sysDomain.system_roles || {};
    for (const [name, role] of Object.entries(custom)) {
        all[name] = { display: role.display || name, priv: role.priv || 0,
                      editable: true, builtin: false };
    }
    _cache = all;
    _cacheAt = now;
    return all;
}

function invalidateCache() { _cache = null; _cacheAt = 0; }

function saveSystemRole(name, def) {
    const sysDomain = storage.loadDomain('system');
    if (!sysDomain.system_roles) sysDomain.system_roles = {};
    sysDomain.system_roles[name] = def;
    storage.saveDomain('system', sysDomain);
    invalidateCache();
}

function deleteSystemRole(name) {
    const sysDomain = storage.loadDomain('system');
    if (!sysDomain.system_roles || !sysDomain.system_roles[name]) return;
    delete sysDomain.system_roles[name];
    storage.saveDomain('system', sysDomain);
    invalidateCache();
}

function getRolePriv(roleName) {
    const roles = loadRoles();
    if (roles[roleName]) return roles[roleName].priv || 0;
    return PRIV.USER_PROFILE; // fallback
}

function roleExists(roleName) {
    return !!loadRoles()[roleName];
}

module.exports = {
    loadRoles, saveSystemRole, deleteSystemRole,
    getRolePriv, roleExists, invalidateCache,
};
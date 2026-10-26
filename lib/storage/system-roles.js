'use strict';
const storage = require('./index');
const { SYSTEM_ROLES_BUILTIN } = require('../permissions');
let _cache = null;
let _cacheAt = 0;
const TTL = 60 * 1000;
function emptyPrivs() {
    return { base: 0, system: 0, discuss: 0, message: 0, file: 0, member: 0, domain: 0 };
}
function loadRoles() {
    const now = Date.now();
    if (_cache && now - _cacheAt < TTL) return _cache;
    const sysDomain = storage.loadDomain('system') || {};
    const overrides = sysDomain.system_role_privs || {};
    const custom = sysDomain.system_roles || {};
    const builtin = SYSTEM_ROLES_BUILTIN || {};
    const all = {};
    for (const [name, role] of Object.entries(builtin)) {
        let privs = role.privs;
        if (role.editable && overrides[name] && typeof overrides[name] === 'object') {
            privs = overrides[name];
        }
        all[name] = {
            display: role.display,
            editable: role.editable,
            builtin: true,
            privs: privs,
        };
    }
    for (const [name, role] of Object.entries(custom)) {
        all[name] = {
            display: role.display || name,
            editable: true,
            builtin: false,
            privs: role.privs || emptyPrivs(),
        };
    }
    _cache = all;
    _cacheAt = now;
    return all;
}
function invalidateCache() { _cache = null; _cacheAt = 0; }
function saveRolePrivs(roleName, privs) {
    const sysDomain = storage.loadDomain('system');
    const builtin = SYSTEM_ROLES_BUILTIN[roleName];
    if (builtin) {
        if (!builtin.editable) return;
        if (!sysDomain.system_role_privs) sysDomain.system_role_privs = {};
        sysDomain.system_role_privs[roleName] = privs;
    } else {
        if (!sysDomain.system_roles) sysDomain.system_roles = {};
        if (!sysDomain.system_roles[roleName]) {
            sysDomain.system_roles[roleName] = { display: roleName };
        }
        sysDomain.system_roles[roleName].privs = privs;
    }
    storage.saveDomain('system', sysDomain);
    invalidateCache();
}
function createRole(name, display) {
    const sysDomain = storage.loadDomain('system');
    if (!sysDomain.system_roles) sysDomain.system_roles = {};
    const memberDefaults = SYSTEM_ROLES_BUILTIN.member.privs;
    sysDomain.system_roles[name] = {
        display: display || name,
        privs: JSON.parse(JSON.stringify(memberDefaults)),
    };
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
function copyPrivs(privs) {
    const out = emptyPrivs();
    if (privs && typeof privs === 'object') {
        for (const g of Object.keys(out)) {
            const v = privs[g];
            if (typeof v === 'number' && isFinite(v)) out[g] = v >>> 0;
        }
    }
    return out;
}
function getRolePrivs(roleName) {
    try {
        const roles = loadRoles();
        if (roles[roleName] && roles[roleName].privs) {
            return copyPrivs(roles[roleName].privs);
        }
        if (roles.member && roles.member.privs) {
            return copyPrivs(roles.member.privs);
        }
    } catch (e) {}
    return copyPrivs(SYSTEM_ROLES_BUILTIN.member.privs);
}
function roleExists(roleName) {
    return !!loadRoles()[roleName];
}
module.exports = {
    loadRoles, invalidateCache,
    saveRolePrivs, createRole, deleteRole,
    getRolePrivs, roleExists, copyPrivs,
};

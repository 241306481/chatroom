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

    // 内置角色
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

    // 自定义角色
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

// 保存角色 privs
// - 内置可编辑角色 → system_role_privs
// - 自定义角色 → system_roles[name].privs
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

// 返回防御性副本。
//
// 原实现直接返回 roles[roleName].privs —— 对内置角色而言这是
// SYSTEM_ROLES_BUILTIN 常量本身的引用（loadRoles 里 privs = role.privs）。
// 任何调用方就地修改返回对象（例如 user.privs.base |= X）都会
// 一次性抬高所有同角色用户的权限，并把内置常量在进程内永久污染。
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
        // 角色不存在（被误配、跨进程新建、或缓存尚未刷新）时回落到 member，
        // 而不是那个只带 base:1 的近零掩码 —— 后者会把用户静默降权到几乎什么都做不了。
        if (roles.member && roles.member.privs) {
            return copyPrivs(roles.member.privs);
        }
    } catch (e) {}
    // 最终兜底
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
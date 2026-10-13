'use strict';
const fs = require('fs');
const {
    DOMAIN_DIR, domainDir, domainConfigPath,
    domainFilesDir, domainDiscussDir,
} = require('./paths');
const { ensureDir, readJson, writeJsonAtomic, nowIso } = require('./fs-utils');
const { ADMIN_LEVEL } = require('../permissions');

// ============================================================
// 单域
// ============================================================
function loadDomain(name) { return readJson(domainConfigPath(name)) || {}; }
function saveDomain(name, domain) { writeJsonAtomic(domainConfigPath(name), domain); }
function domainExists(name) { return fs.existsSync(domainConfigPath(name)); }

// ============================================================
// 域列表
// ============================================================
function listAllDomains() {
    if (!fs.existsSync(DOMAIN_DIR)) return [];
    return fs.readdirSync(DOMAIN_DIR)
        .filter(d => fs.existsSync(require('./paths').domainConfigPath(d)));
}

// ============================================================
// 创建 / 删除
// ============================================================
function createDomain(name, displayName, ownerId) {
    if (domainExists(name)) throw new Error('域已存在');
    if (!/^[a-z0-9_-]{2,32}$/.test(name)) {
        throw new Error('域名只能含小写字母、数字、下划线、短横线，长度 2-32');
    }
    const domain = {
        name, display_name: displayName || name, announcement: '',
        owner_id: ownerId,
        join_policy: 'closed',
        created_at: nowIso(),
        members: { [ownerId]: { role: 'root', level: ADMIN_LEVEL, exp: 0, joined_at: nowIso() } },
        roles: {}, perm_overrides: {},
        join_applications: [],
    };
    saveDomain(name, domain);
    ensureDir(domainDiscussDir(name));
    ensureDir(domainFilesDir(name));
    // 延迟 require，避免循环
    require('./discussions').saveDiscussion(name, 'general', {
        name: 'general', title: '综合讨论', created_at: nowIso(), pinned_messages: [],
    });
    return name;
}

function deleteDomain(name) {
    if (name === 'system') throw new Error('不能删除 system');
    if (!domainExists(name)) throw new Error('域不存在');
    fs.rmSync(domainDir(name), { recursive: true, force: true });
    return true;
}

// ============================================================
// 系统域初始化
// ============================================================
function ensureSystemDomain() {
    if (domainExists('system')) return;
    const domain = {
        name: 'system', display_name: '主聊天室',
        announcement: '欢迎来到聊天室！', owner_id: '',
        join_policy: 'closed',
        created_at: nowIso(), members: {}, roles: {}, perm_overrides: {},
        join_applications: [],
        system_role_privs: {},
        system_roles: {},
        system_config: {
            site_name: '离线聊天室', site_announcement: '',
            allow_register: true, allow_create_domain: true,
            allow_file_upload: true, max_domains_per_user: 5,
            max_file_size_mb: 50, session_timeout_hours: 24,
        },
    };
    saveDomain('system', domain);
    ensureDir(domainDiscussDir('system'));
    ensureDir(domainFilesDir('system'));
    require('./discussions').saveDiscussion('system', 'general', {
        name: 'general', title: '综合讨论', created_at: nowIso(), pinned_messages: [],
    });
}

module.exports = {
    loadDomain, saveDomain, domainExists, listAllDomains,
    createDomain, deleteDomain, ensureSystemDomain,
};
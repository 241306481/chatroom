'use strict';
const fs = require('fs');
const path = require('path');
const {
    USER_DIR, COUNTER_FILE, SYSTEM_UID,
    userConfigPath, userFilesDir, userMsgDir,
    NICKNAME_INDEX_FILE,
} = require('./paths');
const { ensureDir, readJson, writeJsonAtomic, nowIso, hashPassword } = require('./fs-utils');
const { PRIV_ALL, ADMIN_LEVEL } = require('../permissions');

// 派生权限的兜底值（全 0）
const EMPTY_PRIVS = {
    base: 0, system: 0, discuss: 0,
    message: 0, file: 0, member: 0, domain: 0,
};

// ============================================================
// UID 计数器
// ============================================================
function readCounter() {
    let c = null;
    if (fs.existsSync(COUNTER_FILE)) {
        try { c = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')); } catch (e) { c = null; }
    }
    // 文件缺失或损坏时不能简单退回 { last: 1 }：
    // 那样下一个 getNextUid() 会复用已存在的 uid，saveUser 直接覆盖
    // 别人的 config.json（密码哈希、昵称、系统角色、封禁标记全丢）。
    // 一律改为按磁盘上实际存在的最大 uid 重建。
    const derived = maxExistingUid();
    const parsed = (c && typeof c.last === 'number' && isFinite(c.last)) ? c.last : 0;
    const last = Math.max(parsed, derived, 1);
    return { last };
}
function writeCounter(c) { writeJsonAtomic(COUNTER_FILE, c); }
function getNextUid() {
    const c = readCounter();
    c.last += 1;
    writeCounter(c);
    return String(c.last);
}

// 扫描用户目录，取数值型 uid 的最大值
function maxExistingUid() {
    let max = 0;
    let entries;
    try { entries = fs.readdirSync(USER_DIR); } catch (e) { return 0; }
    for (const name of entries) {
        const n = parseInt(name, 10);
        if (String(n) === name && n > max) max = n;
    }
    return max;
}

// ============================================================
// 昵称索引（纯缓存，可随时由 listRealUsers 重建）
// ============================================================
let _indexCache = null;

function loadIndexFile() {
    if (!fs.existsSync(NICKNAME_INDEX_FILE)) return null;
    try {
        const obj = JSON.parse(fs.readFileSync(NICKNAME_INDEX_FILE, 'utf8'));
        if (obj && typeof obj === 'object') {
            // 转成 null 原型：昵称允许 __proto__ 这类字符，
            // 普通对象上 idx['__proto__'] = uid 会被原型 setter 吞掉，
            // 导致该昵称永远无法通过索引登录。
            return Object.assign(Object.create(null), obj);
        }
    } catch (e) {}
    return null;
}

function saveIndexFile(idx) {
    ensureDir(path.dirname(NICKNAME_INDEX_FILE));
    fs.writeFileSync(NICKNAME_INDEX_FILE, JSON.stringify(idx, null, 2), 'utf8');
}

function rebuildIndex() {
    const idx = Object.create(null);
    for (const u of listRealUsers()) {
        if (u.nickname) idx[u.nickname] = u.id;
    }
    _indexCache = idx;
    saveIndexFile(idx);
    return idx;
}

function getIndex() {
    if (_indexCache) return _indexCache;
    const loaded = loadIndexFile();
    if (loaded) { _indexCache = loaded; return loaded; }
    return rebuildIndex();
}

function indexSet(nickname, uid) {
    const idx = getIndex();
    if (!nickname) return;
    idx[nickname] = uid;
    saveIndexFile(idx);
}

function indexRename(oldNick, newNick, uid) {
    const idx = getIndex();
    if (oldNick && idx[oldNick] === uid) delete idx[oldNick];
    if (newNick) idx[newNick] = uid;
    saveIndexFile(idx);
}

function indexRemove(uid) {
    const idx = getIndex();
    for (const k of Object.keys(idx)) {
        if (idx[k] === uid) delete idx[k];
    }
    saveIndexFile(idx);
}

// ============================================================
// 单用户
// ============================================================
function loadUser(uid) {
    let u;
    try {
        u = readJson(userConfigPath(uid)) || {};
    } catch (e) {
        // uid 非法（含路径分隔符 / '..' / 空串）时按「用户不存在」处理，
        // 而不是把路径校验的异常抛给调用方
        return {};
    }
    if (!u.id) return u;

    // 系统账户（uid=1）保持原 privs 不变
    if (u.is_system) return u;

    // 从 system_role 派生 privs 对象
    if (!u.system_role) u.system_role = 'member';
    try {
        const sysRoles = require('./system-roles');
        u.privs = sysRoles.getRolePrivs(u.system_role);
    } catch (e) {
        u.privs = { ...EMPTY_PRIVS };
    }
    return u;
}

// 派生的便捷函数
function getUserPrivs(user) {
    if (!user) return null;
    if (user.privs) return user.privs;
    // 兜底：从 system_role 派生
    try {
        const sysRoles = require('./system-roles');
        return sysRoles.getRolePrivs(user.system_role || 'member');
    } catch (e) {
        return null;
    }
}

function saveUser(uid, user) {
    const clean = { ...user };
    // privs 是派生字段，不持久化
    if (clean.system_role && !clean.is_system) {
        delete clean.privs;
    }
    // 系统账户的 privs 需要持久化，所以 is_system 时不删
    writeJsonAtomic(userConfigPath(uid), clean);
}
function userExists(uid) {
    try { return fs.existsSync(userConfigPath(uid)); }
    catch (e) { return false; }
}

// ============================================================
// 用户列表
// ============================================================
function listAllUsers() {
    if (!fs.existsSync(USER_DIR)) return [];
    return fs.readdirSync(USER_DIR)
        .filter(d => fs.existsSync(path.join(USER_DIR, d, 'config.json')))
        .map(d => loadUser(d))
        .filter(u => u && u.id);
}

function listRealUsers() {
    return listAllUsers().filter(u => !u.is_system);
}

function findUserByNickname(nickname) {
    if (!nickname) return null;
    const idx = getIndex();
    // 必须先查自有属性：idx 是普通对象，idx['toString'] 之类会拿到
    // Object.prototype 上的继承成员（函数，非空），随后 loadUser(function)
    // 会在 path.join 处抛 TypeError。昵称允许这些字符（validateNickname 只挡
    // 保留词/数字开头/控制字符/反斜杠），注册与登录都会因此直接 500。
    if (!Object.prototype.hasOwnProperty.call(idx, nickname)) return null;
    const uid = idx[nickname];
    if (typeof uid !== 'string' || !uid) return null;
    const u = loadUser(uid);
    if (!u.id || u.nickname !== nickname) return null;
    return u;
}

// ============================================================
// 创建用户
// ============================================================
function createUser(nickname, password) {
    if (findUserByNickname(nickname)) throw new Error('昵称已被占用');
    const uid = getNextUid();
    const isFirst = listRealUsers().length === 0;

    // 基于 UID 生成鲜艳的 HSL 头像色
    const hue = (parseInt(uid, 10) * 137) % 360;

    const user = {
        id: uid, nickname,
        password_hash: hashPassword(password),
        system_role: isFirst ? 'root' : 'member',
        avatar_color: `hsl(${hue}, 65%, 55%)`,
        dm_policy: 'everyone',
        bio: '', created_at: nowIso(),
    };
    saveUser(uid, user);
    indexSet(nickname, uid);
    ensureDir(userFilesDir(uid));
    ensureDir(userMsgDir(uid));

    if (isFirst) {
        // 延迟 require 避免模块初始化期循环
        const domains = require('./domains');
        const domain = domains.loadDomain('system');
        if (!domain.members) domain.members = {};
        domain.members[uid] = { role: 'root', level: ADMIN_LEVEL, exp: 0, joined_at: nowIso() };
        domain.owner_id = uid;
        domains.saveDomain('system', domain);
        console.log(`  [Init] 首个注册用户 uid=${uid} 已获得超级管理员权限`);
    }
    return uid;
}

// ============================================================
// 系统账户
// ============================================================
function ensureSystemUser() {
    if (userExists(SYSTEM_UID)) {
        // 无论计数器文件是否存在，都按磁盘实际 uid 校正一次，
        // 避免计数器丢失/损坏后回退并覆盖已有账号
        const fixed = readCounter();
        try {
            if (fixed.last > 1) writeCounter(fixed);
        } catch (e) {}
        return;
    }
    const user = {
        id: SYSTEM_UID, nickname: 'System', is_system: true,
        privs: {
            base:    PRIV_ALL.base,
            system:  PRIV_ALL.system,
            discuss: PRIV_ALL.discuss,
            message: PRIV_ALL.message,
            file:    PRIV_ALL.file,
            member:  PRIV_ALL.member,
            domain:  PRIV_ALL.domain,
        },
        avatar_color: '#1890ff', bio: '系统账户',
        created_at: nowIso(),
    };
    saveUser(SYSTEM_UID, user);
    ensureDir(userFilesDir(SYSTEM_UID));
    ensureDir(userMsgDir(SYSTEM_UID));
    writeCounter({ last: 1 });
    console.log('  [Init] 系统账户已创建: System (uid=1)');
}

module.exports = {
    readCounter, writeCounter, getNextUid,
    loadUser, saveUser, userExists, getUserPrivs,
    listAllUsers, listRealUsers, findUserByNickname,
    indexSet, indexRename, indexRemove, rebuildIndex,
    createUser, ensureSystemUser,
};
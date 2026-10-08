'use strict';
const fs = require('fs');
const path = require('path');
const {
    USER_DIR, COUNTER_FILE, SYSTEM_UID,
    userConfigPath, userFilesDir, userMsgDir,
} = require('./paths');
const { ensureDir, readJson, writeJsonAtomic, nowIso, hashPassword } = require('./fs-utils');
const { PRIV } = require('../permissions');

// ============================================================
// UID 计数器
// ============================================================
function readCounter() {
    if (!fs.existsSync(COUNTER_FILE)) return { last: 1 };
    try { return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')); }
    catch (e) { return { last: 1 }; }
}
function writeCounter(c) { fs.writeFileSync(COUNTER_FILE, JSON.stringify(c), 'utf8'); }
function getNextUid() {
    const c = readCounter();
    c.last += 1;
    writeCounter(c);
    return String(c.last);
}

// ============================================================
// 单用户
// ============================================================
function loadUser(uid) { return readJson(userConfigPath(uid)) || {}; }
function saveUser(uid, user) { writeJsonAtomic(userConfigPath(uid), user); }
function userExists(uid) { return fs.existsSync(userConfigPath(uid)); }

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
    return listRealUsers().find(u => u.nickname === nickname) || null;
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
        priv: PRIV.USER_PROFILE | PRIV.REGISTER_USER
            | PRIV.SEND_MESSAGE | PRIV.CREATE_DOMAIN
            | PRIV.SEND_DM | PRIV.UPLOAD_FILE
            | (isFirst
                ? (PRIV.MANAGE_ALL_DOMAIN | PRIV.VIEW_ALL_DOMAIN
                   | PRIV.EDIT_SYSTEM | PRIV.UNLIMITED_ACCESS
                   | PRIV.MANAGE_SYSTEM | PRIV.MANAGE_USERS
                   | PRIV.MANAGE_DOMAINS)
                : 0),
        avatar_color: `hsl(${hue}, 65%, 55%)`,
        dm_policy: 'everyone',
        bio: '', created_at: nowIso(),
    };
    saveUser(uid, user);
    ensureDir(userFilesDir(uid));
    ensureDir(userMsgDir(uid));

    if (isFirst) {
        // 延迟 require 避免模块初始化期循环
        const domains = require('./domains');
        const domain = domains.loadDomain('system');
        if (!domain.members) domain.members = {};
        domain.members[uid] = { role: 'root', level: 99, exp: 0, joined_at: nowIso() };
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
        if (!fs.existsSync(COUNTER_FILE)) writeCounter({ last: 1 });
        return;
    }
    const user = {
        id: SYSTEM_UID, nickname: 'System', is_system: true,
        priv: PRIV.ALL, avatar_color: '#1890ff', bio: '系统账户',
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
    loadUser, saveUser, userExists,
    listAllUsers, listRealUsers, findUserByNickname,
    createUser, ensureSystemUser,
};
'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');
const { isUserBanned } = require('./checks');
const { recordDailyLoginExp } = require('./exp');

// ============================================================
// 登录
// ============================================================
function login(nickname, password) {
    const u = storage.findUserByNickname(nickname);
    if (!u || !u.id || u.is_system) return null;
    if (!storage.verifyPassword(password, u.password_hash)) return null;
    if (isUserBanned(u)) {
        throw new Error('你的账号已被封禁'
            + (u.ban_reason ? '：' + u.ban_reason : '')
            + (u.banned_until ? '（至 ' + u.banned_until + '）' : '（永久）'));
    }
    try { recordDailyLoginExp(u.id); } catch (e) {}
    return u.id;
}

// ============================================================
// 注册
// ============================================================
function registerUser(nickname, password) {
    const cfg = storage.loadDomain('system').system_config || {};
    if (cfg.allow_register === false) throw new Error('注册已关闭');
    if (storage.findUserByNickname(nickname)) throw new Error('昵称已被占用');

    const uid = storage.createUser(nickname, password);
    const user = storage.loadUser(uid);
    const isAdmin = hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN);

    // 非超管默认加入 system 域
    if (!isAdmin) {
        const domain = storage.loadDomain('system');
        if (!domain.members) domain.members = {};
        if (!domain.members[uid]) {
            domain.members[uid] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
            storage.saveDomain('system', domain);
        }
    }
    return uid;
}

// ============================================================
// 修改密码
// ============================================================
function changePassword(uid, oldPwd, newPwd) {
    const user = storage.loadUser(uid);
    if (!user.id) throw new Error('用户不存在');
    if (!storage.verifyPassword(oldPwd, user.password_hash)) {
        throw new Error('原密码错误');
    }
    if (!newPwd) throw new Error('新密码不能为空');
    user.password_hash = storage.hashPassword(newPwd);
    storage.saveUser(uid, user);
}

module.exports = { login, registerUser, changePassword };
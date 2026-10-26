'use strict';
const storage = require('../storage');
const { isUserBanned } = require('./checks');
const { validateNickname } = require('../storage/nickname-rules');
function findByAccount(account) {
    const key = String(account || '').trim();
    if (!key) return null;
    if (/^\d+$/.test(key)) {
        const u = storage.loadUser(key);
        if (u && u.id && !u.is_system) return u;
    }
    return storage.findUserByNickname(key);
}
function login(account, password, clientIp) {
    const u = findByAccount(account);
    if (!u || !u.id || u.is_system) return null;
    if (!storage.verifyPassword(password, u.password_hash)) return null;
    if (isUserBanned(u)) {
        throw new Error('你的账号已被封禁'
            + (u.ban_reason ? '：' + u.ban_reason : '')
            + (u.banned_until ? '（至 ' + u.banned_until + '）' : '（永久）'));
    }
    try { require('../storage/user-ips').record(u.id, clientIp || ''); } catch (e) {}
    return u.id;
}
function registerUser(nickname, password, clientIp) {
    const cfg = storage.loadDomain('system').system_config || {};
    if (cfg.allow_register === false) throw new Error('注册已关闭');
    const name = validateNickname(nickname);
    if (storage.findUserByNickname(name)) throw new Error('昵称已被占用');
    const uid = storage.createUser(name, password);
    const user = storage.loadUser(uid);
    try { require('../storage/user-ips').record(uid, clientIp || ''); } catch (e) {}
    return uid;
}
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
module.exports = {
    findByAccount, login, registerUser, changePassword };

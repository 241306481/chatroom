'use strict';
const storage = require('../../../storage');
const { C, resolveUser, userTag } = require('../../ui');

// ============================================================
// user nick —— 修改昵称
// ============================================================
function nick(args) {
    const uid = args[0];
    const newNick = args.slice(1).join(' ').trim();
    if (!uid || !newNick) { console.log(`${C.red}用法：user nick <uid> <newnick>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    const existing = storage.findUserByNickname(newNick);
    if (existing && existing.id !== uid) {
        console.log(`${C.red}✘ 昵称「${newNick}」已被 ${userTag(existing)} 占用${C.reset}`);
        return;
    }
    const old = u.nickname;
    u.nickname = newNick;
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ ${userTag({ id: uid, nickname: old })} → ${C.reset}${C.cyan}${newNick}${C.reset}`);
}

// ============================================================
// user bio —— 修改简介
// ============================================================
function bio(args) {
    const uid = args[0];
    const text = args.slice(1).join(' ');
    if (!uid) { console.log(`${C.red}用法：user bio <uid> <text>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    u.bio = text || '';
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ 已更新 ${userTag(u)} 的简介${C.reset}`);
}

// ============================================================
// user priv —— 修改权限位（十六进制）
// ============================================================
function priv(args) {
    const uid = args[0];
    const hex = args[1];
    if (!uid || !hex) {
        console.log(`${C.red}用法：user priv <uid> <hex>${C.reset}`);
        console.log(`${C.gray}  hex：权限位（十六进制，如 1f）${C.reset}`);
        return;
    }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    const cleanHex = hex.replace(/^0x/i, '');
    if (!/^[0-9a-f]{1,8}$/i.test(cleanHex)) {
        console.log(`${C.red}✘ 非法十六进制：${hex}${C.reset}`);
        return;
    }
    const oldPriv = u.priv || 0;
    u.priv = parseInt(cleanHex, 16) >>> 0;
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ 已更新 ${userTag(u)} 的权限：`
        + `0x${(oldPriv >>> 0).toString(16)} → 0x${(u.priv >>> 0).toString(16)}${C.reset}`);
}

// ============================================================
// user avatar —— 修改头像色
// ============================================================
function avatar(args) {
    const uid = args[0];
    const color = args[1];
    if (!uid || !color) { console.log(`${C.red}用法：user avatar <uid> <color>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    u.avatar_color = color;
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ 已更新 ${userTag(u)} 的头像色为 ${color}${C.reset}`);
}

// ============================================================
// user password —— 重置密码
// ============================================================
function password(args) {
    const uid = args[0];
    const newpwd = args[1];
    if (!uid || !newpwd) { console.log(`${C.red}用法：user password <uid> <newpwd>${C.reset}`); return; }
    if (newpwd.length < 4) { console.log(`${C.red}✘ 新密码至少 4 位${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    u.password_hash = storage.hashPassword(newpwd);
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ 已重置用户 ${uid}（${u.nickname}）的密码${C.reset}`);
}

module.exports = { nick, bio, priv, avatar, password };
'use strict';
const auth = require('../../../auth');
const storage = require('../../../storage');
const { C } = require('../../ui');
const CONSOLE_UID = storage.SYSTEM_UID;
function ban(args) {
    const uid = args[0];
    const reason = args.slice(1).join(' ');
    if (!uid) { console.log(`${C.red}用法：user ban <uid> [reason]${C.reset}`); return; }
    try {
        auth.banUserGlobally(uid, reason || '', '', CONSOLE_UID);
        console.log(`${C.green}✔ 已封禁用户 ${uid}${reason ? '（' + reason + '）' : ''}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}
function unban(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user unban <uid>${C.reset}`); return; }
    try {
        const u = storage.loadUser(uid);
        if (!u.id) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
        if (!u.banned) {
            console.log(`${C.yellow}用户 ${uid} 当前并未被封禁${C.reset}`); return;
        }
        auth.unbanUserGlobally(uid);
        console.log(`${C.green}✔ 已解封用户 ${uid}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}
function admin(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user admin <uid>${C.reset}`); return; }
    try {
        auth.setSystemRole(uid, 'admin');
        console.log(`${C.green}✔ 已授予用户 ${uid} 系统管理员权限${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}
function deadmin(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user deadmin <uid>${C.reset}`); return; }
    try {
        auth.setSystemRole(uid, 'member');
        console.log(`${C.green}✔ 已撤销用户 ${uid} 系统管理员权限${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}
module.exports = { ban, unban, admin, deadmin };

'use strict';
const auth = require('../../../auth');
const { C } = require('../../ui');

// ============================================================
// user ban —— 全局封禁
// ============================================================
function ban(args) {
    const uid = args[0];
    const reason = args.slice(1).join(' ');
    if (!uid) { console.log(`${C.red}用法：user ban <uid> [reason]${C.reset}`); return; }
    try {
        auth.banUserGlobally(uid, reason || '', '', 'console');
        console.log(`${C.green}✔ 已封禁用户 ${uid}${reason ? '（' + reason + '）' : ''}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

// ============================================================
// user unban —— 解除封禁
// ============================================================
function unban(uid) {
    if (!uid) { console.log(`${C.red}用法：user unban <uid>${C.reset}`); return; }
    try {
        auth.unbanUserGlobally(uid);
        console.log(`${C.green}✔ 已解封用户 ${uid}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

// ============================================================
// user admin —— 授予系统管理员
// ============================================================
function admin(uid) {
    if (!uid) { console.log(`${C.red}用法：user admin <uid>${C.reset}`); return; }
    try {
        auth.setSystemAdmin(uid, true);
        console.log(`${C.green}✔ 已授予用户 ${uid} 系统管理员权限${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

// ============================================================
// user deadmin —— 撤销系统管理员
// ============================================================
function deadmin(uid) {
    if (!uid) { console.log(`${C.red}用法：user deadmin <uid>${C.reset}`); return; }
    try {
        auth.setSystemAdmin(uid, false);
        console.log(`${C.green}✔ 已撤销用户 ${uid} 系统管理员权限${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

module.exports = { ban, unban, admin, deadmin };
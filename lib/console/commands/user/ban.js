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
function unban(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user unban <uid>${C.reset}`); return; }
    try {
        auth.unbanUserGlobally(uid);
        console.log(`${C.green}✔ 已解封用户 ${uid}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

// ============================================================
// user admin / deadmin —— 系统管理员角色
// auth.setSystemAdmin 早已不存在（已由 setSystemRole 取代），
// 此处仍调用它会让这两条命令必然抛 TypeError。
// ============================================================
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
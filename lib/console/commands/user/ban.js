'use strict';
const auth = require('../../../auth');
const storage = require('../../../storage');
const { C } = require('../../ui');

// ============================================================
// user ban —— 全局封禁
// ============================================================
// 第四个参数是 banned_by（会被原样写进用户记录），bans.js 会用
// storage.loadUser(byUid) 取出该账号并检查它是否拥有 MANAGE_ALL。
// 传字符串 'console' 是错的：那不是一个真实账号，loadUser 返回 {}，
// 于是 (a) 永远无法封禁系统管理员（提示「系统管理员不能被系统管理员封禁」，
//     但控制台本应是最高权限），(b) banned_by 记下一个查无此人的 uid。
// 系统账户 (uid=1) 的 privs 是持久化的 PRIV_ALL，能正确通过超管判定，
// 并且是可解析的审计对象。
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

// ============================================================
// user unban —— 解除封禁
// ============================================================
function unban(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user unban <uid>${C.reset}`); return; }
    try {
        // unbanUserGlobally 对「本来就没被封禁」的用户只是把不存在的键删掉
        // 再存回去，属于静默 no-op；直接打印「已解封」会误导运维。
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
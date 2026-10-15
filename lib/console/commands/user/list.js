'use strict';
const storage = require('../../../storage');
const { C, padR, fmtIso, privLabel, banMark } = require('../../ui');

// user list —— 列出所有用户
function list() {
    const users = storage.listRealUsers();
    if (!users.length) { console.log(`${C.gray}（无用户）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('UID', 6)
        + padR('昵称', 20)
        + padR('权限', 20)
        + padR('状态', 10)
        + '注册时间' + C.reset);
    console.log(`${C.gray}${'─'.repeat(78)}${C.reset}`);
    for (const u of users) {
        console.log(
            padR(u.id, 6) +
            padR(u.nickname || '?', 20) +
            padR(privLabel(u.privs), 20) +
            padR(banMark(u), 10) +
            fmtIso(u.created_at)
        );
    }
    console.log(`${C.gray}共 ${users.length} 个用户${C.reset}`);
}

// user online —— 列出当前在线用户
function online() {
    const users = storage.listRealUsers().filter(u => storage.isOnlineAnywhere(u.id));
    if (!users.length) { console.log(`${C.gray}（当前无人在线）${C.reset}`); return; }
    for (const u of users) {
        const domains = storage.listAllDomains().filter(dn => storage.isOnline(u.id, dn));
        console.log(`  ${C.green}●${C.reset} ${C.cyan}${u.id}${C.reset}  ${u.nickname}  ${C.gray}${domains.join(', ')}${C.reset}`);
    }
    console.log(`${C.gray}共 ${users.length} 人在线${C.reset}`);
}

module.exports = { list, online };
'use strict';
const storage = require('../../../storage');
const { C, padR } = require('../../ui');

// ============================================================
// 关注
// ============================================================
function follow(args) {
    const [uid, target] = args;
    if (!uid || !target) { console.log(`${C.red}用法：user follow <uid> <target>${C.reset}`); return; }
    const ok = storage.follow(uid, target);
    console.log(ok ? `${C.green}✔ ${uid} 关注了 ${target}${C.reset}`
                  : `${C.red}✘ 关注失败（可能不存在 / 是系统账号 / 自己关注自己）${C.reset}`);
}

function unfollow(args) {
    const [uid, target] = args;
    if (!uid || !target) { console.log(`${C.red}用法：user unfollow <uid> <target>${C.reset}`); return; }
    const ok = storage.unfollow(uid, target);
    console.log(ok ? `${C.green}✔ ${uid} 取关了 ${target}${C.reset}`
                  : `${C.red}✘ 取关失败${C.reset}`);
}

function following(uid) {
    if (!uid) { console.log(`${C.red}用法：user following <uid>${C.reset}`); return; }
    const list = storage.getFollowing(uid);
    if (!list.length) { console.log(`${C.gray}（没有关注任何人）${C.reset}`); return; }
    console.log(`${C.bold}${uid} 关注 ${list.length} 人${C.reset}`);
    for (const t of list) {
        const u = storage.loadUser(t);
        console.log(`  ${C.cyan}${padR(t, 6)}${C.reset}${u.nickname || '?'}`);
    }
}

function followers(uid) {
    if (!uid) { console.log(`${C.red}用法：user followers <uid>${C.reset}`); return; }
    const list = storage.getFollowers(uid);
    if (!list.length) { console.log(`${C.gray}（没有粉丝）${C.reset}`); return; }
    console.log(`${C.bold}${uid} 的粉丝 ${list.length} 人${C.reset}`);
    for (const t of list) {
        const u = storage.loadUser(t);
        console.log(`  ${C.cyan}${padR(t, 6)}${C.reset}${u.nickname || '?'}`);
    }
}

// ============================================================
// 黑名单
// ============================================================
function block(args) {
    const [uid, target] = args;
    if (!uid || !target) { console.log(`${C.red}用法：user block <uid> <target>${C.reset}`); return; }
    const ok = storage.blockUser(uid, target);
    console.log(ok ? `${C.green}✔ ${uid} 拉黑了 ${target}${C.reset}`
                  : `${C.red}✘ 拉黑失败${C.reset}`);
}

function unblock(args) {
    const [uid, target] = args;
    if (!uid || !target) { console.log(`${C.red}用法：user unblock <uid> <target>${C.reset}`); return; }
    const ok = storage.unblockUser(uid, target);
    console.log(ok ? `${C.green}✔ ${uid} 已解除对 ${target} 的拉黑${C.reset}`
                  : `${C.red}✘ 解除失败${C.reset}`);
}

function blocked(uid) {
    if (!uid) { console.log(`${C.red}用法：user blocked <uid>${C.reset}`); return; }
    const list = storage.getBlocked(uid);
    if (!list.length) { console.log(`${C.gray}（黑名单为空）${C.reset}`); return; }
    console.log(`${C.bold}${uid} 拉黑了 ${list.length} 人${C.reset}`);
    for (const t of list) {
        const u = storage.loadUser(t);
        console.log(`  ${C.cyan}${padR(t, 6)}${C.reset}${u.nickname || '?'}`);
    }
}

function blockedby(uid) {
    if (!uid) { console.log(`${C.red}用法：user blockedby <uid>${C.reset}`); return; }
    const list = storage.getBlockedBy(uid);
    if (!list.length) { console.log(`${C.gray}（没有被拉黑）${C.reset}`); return; }
    console.log(`${C.bold}${uid} 被 ${list.length} 人拉黑${C.reset}`);
    for (const t of list) {
        const u = storage.loadUser(t);
        console.log(`  ${C.cyan}${padR(t, 6)}${C.reset}${u.nickname || '?'}`);
    }
}

module.exports = {
    follow, unfollow, following, followers,
    block, unblock, blocked, blockedby,
};
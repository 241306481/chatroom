'use strict';
const storage = require('../../../storage');
const auth = require('../../../auth');
const { C, padR, fmtIso, privLabel, DM_POLICY_LABELS, resolveUser } = require('../../ui');

// ============================================================
// user show —— 用户详情
// ============================================================
function show(uid) {
    if (!uid) { console.log(`${C.red}用法：user show <uid>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}用户 ${uid} 不存在${C.reset}`); return; }

    console.log(`${C.bold}用户详情 UID=${u.id}${C.reset}`);
    console.log(`  昵称：      ${u.nickname}`);
    console.log(`  头像色：    ${u.avatar_color || '—'}`);
    console.log(`  系统角色：  ${u.system_role || 'member'}`);
    console.log(`  权限：      ${privLabel(u.privs)}`);
    console.log(`  注册时间：  ${fmtIso(u.created_at)}`);
    console.log(`  个人简介：  ${u.bio || '（空）'}`);
    console.log(`  在线状态：  ${storage.isOnlineAnywhere(u.id) ? C.green + '在线' + C.reset : C.gray + '离线' + C.reset}`);
    console.log(`  私信策略：  ${DM_POLICY_LABELS[u.dm_policy || 'everyone'] || u.dm_policy || 'everyone'}`);

    if (auth.isUserBanned(u)) {
        console.log(`  ${C.red}封禁状态：  已封禁${C.reset}`);
        console.log(`    原因：    ${u.ban_reason || '—'}`);
        console.log(`    有效期：  ${u.banned_until ? '至 ' + u.banned_until : '永久'}`);
        console.log(`    操作者：  ${u.banned_by || '—'}`);
    }

    const counts = storage.getFollowCounts(u.id);
    console.log(`  关注 / 粉丝：${counts.following} / ${counts.followers}`);
    const blocked = storage.getBlocked(u.id);
    const blockedBy = storage.getBlockedBy(u.id);
    if (blocked.length)   console.log(`  黑名单：    ${blocked.length} 人`);
    if (blockedBy.length) console.log(`  被拉黑：    ${blockedBy.length} 人`);

    const owned = storage.listAllDomains().filter(dn => storage.loadDomain(dn).owner_id === u.id);
    if (owned.length) console.log(`  拥有域：    ${owned.join(', ')}`);

    const memberOf = [];
    for (const dn of storage.listAllDomains()) {
        const d = storage.loadDomain(dn);
        if (d.members && d.members[u.id]) {
            memberOf.push(`${dn}(${d.members[u.id].role || 'default'})`);
        }
    }
    if (memberOf.length) console.log(`  加入域：    ${memberOf.join(', ')}`);

    const fileCount = storage.listUserFiles(u.id).length;
    if (fileCount) console.log(`  文件数：    ${fileCount}（user file list ${u.id} 查看）`);
}

// ============================================================
// user find —— 按昵称模糊查找
// ============================================================
function find(name) {
    if (!name) { console.log(`${C.red}用法：user find <nickname>${C.reset}`); return; }
    const users = storage.listRealUsers().filter(u => (u.nickname || '').includes(name));
    if (!users.length) { console.log(`${C.yellow}未找到匹配用户${C.reset}`); return; }
    for (const u of users) {
        console.log(`  ${C.cyan}${padR(u.id, 6)}${C.reset}${padR(u.nickname, 20)}${C.gray}${privLabel(u.privs)}${C.reset}`);
    }
}

module.exports = { show, find };
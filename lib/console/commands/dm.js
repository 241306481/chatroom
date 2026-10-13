'use strict';
const storage = require('../../storage');
const {
    C, fmtIso, shortId, DM_POLICY_LABELS,
    resolveUser, userTag,
} = require('../ui');

function list(args) {
    const [uid, target] = args;
    if (!uid || !target) { console.log(`${C.red}用法：user dm list <uid> <target>${C.reset}`); return; }
    const msgs = storage.loadDM(uid, target, 200);
    if (!msgs.length) { console.log(`${C.gray}（无消息）${C.reset}`); return; }
    console.log(`${C.bold}${uid} ↔ ${target}（${msgs.length} 条）${C.reset}`);
    for (const m of msgs) {
        const from = m.from === uid ? C.cyan + uid + C.reset : C.magenta + m.from + C.reset;
        const mark = m.read ? ' ' : '*';
        console.log(`  ${C.gray}${fmtIso(m.created_at)}${C.reset} ${from}${mark} ${storage.sliceChars(m.content, 80)}`);
    }
}

function send(args) {
    const [uid, target, ...rest] = args;
    const content = rest.join(' ');
    if (!uid || !target || !content) {
        console.log(`${C.red}用法：user dm send <uid> <target> <content>${C.reset}`); return;
    }
    try {
        const m = storage.appendDM(uid, target, content);
        console.log(`${C.green}✔ 已发送：${shortId(m.id, 8)}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

function clear(args) {
    const [uid, target] = args;
    if (!uid || !target) { console.log(`${C.red}用法：user dm clear <uid> <target>${C.reset}`); return; }
    try {
        // 必须走 clearDM：它会一并清掉双方的未读计数与会话索引。
        // 此前只清消息文件 + 未读计数，conversations.json 里残留的
        // last_at 指向已被删除的消息，且无法自愈。
        storage.clearDM(uid, target);
        console.log(`${C.green}✔ 已清空 ${uid} ↔ ${target} 的私信（含未读计数与会话索引）${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

function policy(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user dm policy <uid> [policy]${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    const p = args[1];
    if (!p) {
        const cur = u.dm_policy || 'everyone';
        console.log(`${C.bold}${userTag(u)} 的私信策略${C.reset}`);
        console.log(`  当前：${cur}（${DM_POLICY_LABELS[cur] || '未知'}）`);
        console.log(`${C.gray}  可选：everyone / mutual / following / admin${C.reset}`);
        return;
    }
    const valid = ['everyone', 'mutual', 'following', 'admin'];
    if (!valid.includes(p)) {
        console.log(`${C.red}✘ 未知策略：${p}${C.reset}`);
        console.log(`${C.gray}  可选：${valid.join(' / ')}${C.reset}`);
        return;
    }
    u.dm_policy = p;
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ ${userTag(u)} 的私信策略已设为 ${p}（${DM_POLICY_LABELS[p]}）${C.reset}`);
}

module.exports = { list, send, clear, policy };
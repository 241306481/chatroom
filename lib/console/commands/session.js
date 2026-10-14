'use strict';
// 会话管理。
//
// Web 端改密码/封禁时靠 auth 层顺手踢会话，但控制台没有「强制某用户下线」
// 这个动作 —— 怀疑账号被盗时唯一的办法是改密码。
const sessions = require('../../auth/sessions');
const storage = require('../../storage');
const { C, padR } = require('../ui');

function usage(sub) {
    console.log(`${C.red}用法：session ${sub}${C.reset}`);
}

function kick(args) {
    const uid = args[0];
    if (!uid) { usage('kick <uid>'); return; }
    const u = storage.loadUser(uid);
    if (!u || !u.id) { console.log(`${C.red}用户不存在：${uid}${C.reset}`); return; }
    const n = sessions.destroyAllUserSessions(uid);
    console.log(`${C.green}✔ 已注销 ${u.nickname || uid} 的全部会话（${n} 个）${C.reset}`);
    if (!n) console.log(`${C.gray}  该用户当前没有有效会话${C.reset}`);
}

function info(args) {
    const uid = args[0];
    if (!uid) { usage('info <uid>'); return; }
    const u = storage.loadUser(uid);
    if (!u || !u.id) { console.log(`${C.red}用户不存在：${uid}${C.reset}`); return; }
    // 会话是内存态，sessions 模块只提供按 uid 全量注销，
    // 逐条列举需要额外的索引，这里如实说明而不是编造一个计数。
    console.log(`${C.bold}${u.nickname || '?'} (${uid})${C.reset}`);
    console.log(`  会话索引：${C.gray}内存态，未提供逐条列举${C.reset}`);
    console.log(`  提示：${C.gray}用 "session kick ${uid}" 可一次性注销全部会话${C.reset}`);
}

module.exports = { kick, info };
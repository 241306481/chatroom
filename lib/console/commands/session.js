'use strict';
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
    console.log(`${C.bold}${u.nickname || '?'} (${uid})${C.reset}`);
    console.log(`  会话索引：${C.gray}内存态，未提供逐条列举${C.reset}`);
    console.log(`  提示：${C.gray}用 "session kick ${uid}" 可一次性注销全部会话${C.reset}`);
}
module.exports = { kick, info };

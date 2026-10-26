'use strict';
const storage = require('../../storage');
const { C, padR, fmtIso } = require('../ui');
function usage(sub) {
    console.log(`${C.red}用法：msg ${sub}${C.reset}`);
}
function checkDisc(dn, disc) {
    if (!storage.domainExists(dn)) { console.log(`${C.red}域不存在：${dn}${C.reset}`); return null; }
    if (!storage.loadDiscussion(dn, disc).name) {
        console.log(`${C.red}讨论不存在：${dn}/${disc}${C.reset}`);
        return null;
    }
    return true;
}
function resolveMsg(dn, disc, prefix) {
    const msgs = storage.loadAllMessages(dn, disc) || [];
    const hits = msgs.filter(m => String(m.id).startsWith(prefix));
    if (hits.length === 1) return hits[0];
    if (!hits.length) { console.log(`${C.red}找不到消息：${prefix}${C.reset}`); return null; }
    console.log(`${C.red}前缀 ${prefix} 匹配到 ${hits.length} 条，请写得更完整${C.reset}`);
    return null;
}
function send(args) {
    const [dn, disc, ...rest] = args;
    if (!dn || !disc || !rest.length) {
        usage('send <domain> <disc> <uid> <content...>'); return;
    }
    if (!checkDisc(dn, disc)) return;
    const uid = rest[0];
    const content = rest.slice(1).join(' ');
    const u = storage.loadUser(uid);
    if (!u || !u.id) { console.log(`${C.red}用户不存在：${uid}${C.reset}`); return; }
    const auth = require('../../auth');
    if (auth.isUserBannedInDomain(storage.loadDomain(dn), uid)) {
        console.log(`${C.red}该用户已被域封禁，无法发言${C.reset}`);
        return;
    }
    const msg = {
        id: storage.genUuid(),
        uid,
        nickname: u.nickname || '?',
        content,
        at: storage.nowIso(),
        reactions: {},
    };
    storage.appendMessage(dn, disc, msg);
    const { addExp } = require('../../auth/exp');
    try { addExp(dn, uid, 1); } catch (e) {}
    console.log(`${C.green}✔ 已在 ${dn}/${disc} 追加一条消息${C.reset}`);
    console.log(`${C.gray}  msgId=${msg.id}${C.reset}`);
}
function react(args) {
    const [dn, disc, msgId, uid, ...rest] = args;
    if (!dn || !disc || !msgId || !uid || !rest.length) {
        usage('react <domain> <disc> <msgId> <uid> <emoji>'); return;
    }
    if (!checkDisc(dn, disc)) return;
    const m = resolveMsg(dn, disc, msgId);
    if (!m) return;
    const emoji = rest[0];
    storage.toggleReaction(dn, disc, m.id, uid, emoji);
    const after = storage.findMessage(dn, disc, m.id) || {};
    console.log(`${C.green}✔ 已切换表情 ${emoji}${C.reset}`);
    console.log(`  ${JSON.stringify(after.reactions || {})}`);
}
function remove(args) {
    const [dn, disc, msgId] = args;
    if (!dn || !disc || !msgId) { usage('rm <domain> <disc> <msgId>'); return; }
    if (!checkDisc(dn, disc)) return;
    const m = resolveMsg(dn, disc, msgId);
    if (!m) return;
    storage.updateMessage(dn, disc, m.id, { deleted: true });
    console.log(`${C.green}✔ 已标记删除 ${m.id}${C.reset}`);
}
function pin(args) {
    const [dn, disc, msgId, on] = args;
    if (!dn || !disc || !msgId) { usage('pin <domain> <disc> <msgId> [0|1]'); return; }
    if (!checkDisc(dn, disc)) return;
    const m = resolveMsg(dn, disc, msgId);
    if (!m) return;
    const pinned = on === '0' ? false : true;
    storage.updateMessage(dn, disc, m.id, { pinned });
    console.log(`${C.green}✔ ${pinned ? '已置顶' : '已取消置顶'} ${m.id}${C.reset}`);
}
function tail(args) {
    const [dn, disc, n] = args;
    if (!dn || !disc) { usage('tail <domain> <disc> [n]'); return; }
    if (!checkDisc(dn, disc)) return;
    const limit = Math.min(50, parseInt(n, 10) || 10);
    const all = storage.loadAllMessages(dn, disc) || [];
    const msgs = all.slice(-limit);
    if (!msgs.length) { console.log(`${C.gray}（无消息）${C.reset}`); return; }
    console.log(`${C.bold}${dn}/${disc} 最后 ${msgs.length} 条（共 ${all.length} 条）${C.reset}`);
    for (const m of msgs) {
        const flag = m.deleted ? `${C.red}[已删]${C.reset} `
            : m.pinned ? `${C.yellow}[置顶]${C.reset} ` : '';
        const rx = Object.keys(m.reactions || {}).length
            ? ` ${C.gray}(${Object.entries(m.reactions).map(([e, u]) => e + x(u.length)).join(' ')})${C.reset}`
            : '';
        console.log('  ' + flag + padR(fmtIso(m.at), 22)
            + padR(storage.sliceChars(m.nickname || '?', 16), 18)
            + storage.sliceChars(m.content || '', 60) + rx);
    }
}
module.exports = { send, react, rm: remove, pin, tail };

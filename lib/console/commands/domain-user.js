'use strict';
const storage = require('../../storage');
const auth = require('../../auth');
const { makePrivAll, BUILTIN_ROLES } = require('../../permissions');
const { C, resolveUser, userTag } = require('../ui');

function add(args) {
    const [dn, uid] = args;
    if (!dn || !uid) { console.log(`${C.red}用法：domain user add <domain> <uid>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}用户 ${uid} 不存在${C.reset}`); return; }
    if (d.members && d.members[uid]) { console.log(`${C.yellow}该用户已是成员${C.reset}`); return; }
    if (auth.isUserBannedInDomain(d, uid)) { console.log(`${C.red}✘ 该用户被域封禁，请先 unban${C.reset}`); return; }
    if (!d.members) d.members = {};
    d.members[uid] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
    storage.saveDomain(dn, d);
    console.log(`${C.green}✔ 已将 ${userTag(u)} 加入 ${dn}${C.reset}`);
}

function kick(args) {
    const [dn, uid] = args;
    if (!dn || !uid) { console.log(`${C.red}用法：domain user kick <domain> <uid>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    if (dn === 'system') { console.log(`${C.red}✘ system 域成员不可被踢出${C.reset}`); return; }
    if (d.owner_id === uid) { console.log(`${C.red}✘ 所有者不可被踢出${C.reset}`); return; }
    if (!d.members || !d.members[uid]) { console.log(`${C.yellow}该用户不在域中${C.reset}`); return; }
    auth.kickUser(dn, uid);
    console.log(`${C.green}✔ 已将 ${uid} 从 ${dn} 踢出${C.reset}`);
}

function ban(args) {
    const [dn, uid, ...rest] = args;
    const reason = rest.join(' ');
    if (!dn || !uid) { console.log(`${C.red}用法：domain user ban <domain> <uid> [reason]${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    const actor = { id: d.owner_id || 'console', privs: makePrivAll() };
    try {
        auth.banUserInDomain(dn, uid, reason || '', '', actor);
        console.log(`${C.green}✔ 已在 ${dn} 封禁 ${uid}${reason ? '（' + reason + '）' : ''}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

function unban(args) {
    const [dn, uid] = args;
    if (!dn || !uid) { console.log(`${C.red}用法：domain user unban <domain> <uid>${C.reset}`); return; }
    auth.unbanUserInDomain(dn, uid);
    console.log(`${C.green}✔ 已解除 ${dn} 对 ${uid} 的封禁${C.reset}`);
}

function mute(args) {
    const [dn, uid, mins] = args;
    if (!dn || !uid) { console.log(`${C.red}用法：domain user mute <domain> <uid> [minutes]${C.reset}`); return; }
    const m = parseInt(mins || '60', 10);
    if (!m || m <= 0) { console.log(`${C.red}✘ 分钟数无效${C.reset}`); return; }
    const until = new Date(Date.now() + m * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    auth.muteUser(dn, uid, until);
    console.log(`${C.green}✔ 已在 ${dn} 禁言 ${uid}，${m} 分钟（至 ${until}）${C.reset}`);
}

function unmute(args) {
    const [dn, uid] = args;
    if (!dn || !uid) { console.log(`${C.red}用法：domain user unmute <domain> <uid>${C.reset}`); return; }
    auth.unmuteUser(dn, uid);
    console.log(`${C.green}✔ 已解除 ${dn} 对 ${uid} 的禁言${C.reset}`);
}

function role(args) {
    const [dn, uid, name] = args;
    if (!dn || !uid || !name) { console.log(`${C.red}用法：domain user role <domain> <uid> <role>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    if (!d.members || !d.members[uid]) { console.log(`${C.red}✘ 该用户不在域中${C.reset}`); return; }
    const validRoles = new Set([
        ...Object.keys(BUILTIN_ROLES),
        ...Object.keys(d.roles || {}),
    ]);
    if (!validRoles.has(name)) {
        console.log(`${C.red}✘ 未知角色：${name}${C.reset}`);
        console.log(`${C.gray}  可用：${[...validRoles].join(', ')}${C.reset}`);
        return;
    }
    auth.grantRole(dn, uid, name);
    console.log(`${C.green}✔ 已将 ${dn} 中用户 ${uid} 的角色设置为 ${name}${C.reset}`);
}

module.exports = { add, kick, ban, unban, mute, unmute, role };
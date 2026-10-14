'use strict';
const storage = require('../../storage');
const auth = require('../../auth');
const { C } = require('../ui');

function domainAppApprove(args) {
    const [dn, uid] = args;
    if (!dn || !uid) { console.log(`${C.red}用法：domain app approve <domain> <uid>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    const idx = (d.join_applications || []).findIndex(a => a.uid === uid);
    if (idx === -1) { console.log(`${C.yellow}未找到该申请${C.reset}`); return; }
    if (auth.isUserBannedInDomain(d, uid)) {
        console.log(`${C.red}✘ 该用户已被域封禁，请先 unban${C.reset}`); return;
    }
    if (!d.members) d.members = {};
    d.members[uid] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
    d.join_applications.splice(idx, 1);
    storage.saveDomain(dn, d);
    auth.sendSystemDM(uid, `你加入「${d.display_name || dn}」的申请已通过`);
    console.log(`${C.green}✔ 已通过 ${uid} 加入 ${dn} 的申请${C.reset}`);
}

function domainAppReject(args) {
    const [dn, uid] = args;
    if (!dn || !uid) { console.log(`${C.red}用法：domain app reject <domain> <uid>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    const idx = (d.join_applications || []).findIndex(a => a.uid === uid);
    if (idx === -1) { console.log(`${C.yellow}未找到该申请${C.reset}`); return; }
    d.join_applications.splice(idx, 1);
    storage.saveDomain(dn, d);
    auth.sendSystemDM(uid, `你加入「${d.display_name || dn}」的申请被拒绝`);
    console.log(`${C.green}✔ 已拒绝 ${uid} 加入 ${dn} 的申请${C.reset}`);
}

module.exports = {
    approve: domainAppApprove,
    reject: domainAppReject,
};
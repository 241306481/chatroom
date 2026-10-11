'use strict';
const storage = require('../../../storage');
const auth = require('../../../auth');
const { makePrivAll } = require('../../../permissions');
const { C, resolveUser, userTag } = require('../../ui');

// ============================================================
// domain create —— 创建域
// ============================================================
function create(args) {
    const [name, display, owner] = args;
    if (!name || !owner) {
        console.log(`${C.red}用法：domain create <name> <display> <owner_uid>${C.reset}`); return;
    }
    const u = resolveUser(owner);
    if (!u) { console.log(`${C.red}✘ 所有者 ${owner} 不存在${C.reset}`); return; }
    try {
        storage.createDomain(name, display || name, owner);
        console.log(`${C.green}✔ 已创建域 ${name}（所有者 ${userTag(u)}）${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

// ============================================================
// domain delete —— 删除域
// ============================================================
function del(name) {
    if (!name) { console.log(`${C.red}用法：domain delete <name>${C.reset}`); return; }
    try {
        storage.deleteDomain(name);
        console.log(`${C.green}✔ 已删除域 ${name}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

// ============================================================
// domain transfer —— 转让所有权
// ============================================================
function transfer(args) {
    const [dn, target] = args;
    if (!dn || !target) { console.log(`${C.red}用法：domain transfer <domain> <uid>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    try {
        const actor = { id: 'console', privs: makePrivAll() };
        const r = auth.transferDomain(dn, target, actor);
        console.log(`${C.green}✔ ${dn} 所有权：${r.oldOwner} → ${r.newOwner}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

// ============================================================
// domain announce —— 修改公告
// ============================================================
function announce(args) {
    const [dn, ...rest] = args;
    const text = rest.join(' ');
    if (!dn) { console.log(`${C.red}用法：domain announce <domain> <text>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    d.announcement = text || '';
    storage.saveDomain(dn, d);
    console.log(`${C.green}✔ 已更新 ${dn} 的公告${C.reset}`);
}

module.exports = { create, delete: del, transfer, announce };
'use strict';

// ============================================================
// 客户端注册表
// ============================================================
const discussClients = new Map();  // "domain/discuss" -> Set<ws>
const dmClients = new Map();       // uid             -> Set<ws>
const statusClients = new Map();   // domain          -> Set<ws>

function discussKey(dn, disc) { return `${dn}/${disc}`; }

// ---------------- 注册 / 注销 ----------------
function registerDiscuss(dn, disc, ws) {
    const k = discussKey(dn, disc);
    if (!discussClients.has(k)) discussClients.set(k, new Set());
    discussClients.get(k).add(ws);
    return k;
}
function unregisterDiscuss(k, ws) {
    const set = discussClients.get(k);
    if (set) { set.delete(ws); if (set.size === 0) discussClients.delete(k); }
}

function registerDm(uid, ws) {
    if (!dmClients.has(uid)) dmClients.set(uid, new Set());
    dmClients.get(uid).add(ws);
}
function unregisterDm(uid, ws) {
    const set = dmClients.get(uid);
    if (set) { set.delete(ws); if (set.size === 0) dmClients.delete(uid); }
}

function registerStatus(dn, ws) {
    if (!statusClients.has(dn)) statusClients.set(dn, new Set());
    statusClients.get(dn).add(ws);
}
function unregisterStatus(dn, ws) {
    const set = statusClients.get(dn);
    if (set) { set.delete(ws); if (set.size === 0) statusClients.delete(dn); }
}

// ============================================================
// 广播
// ============================================================
function sendTo(ws, data) {
    if (ws.readyState === 1) {
        try { ws.send(data); } catch (e) {}
    }
}

function broadcastDiscuss(k, payload, exclude) {
    const set = discussClients.get(k);
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const ws of set) {
        if (ws === exclude) continue;
        sendTo(ws, data);
    }
}

function broadcastToDomain(dn, payload) {
    const prefix = dn + '/';
    const data = JSON.stringify(payload);
    for (const [k, set] of discussClients) {
        if (!k.startsWith(prefix)) continue;
        for (const ws of set) sendTo(ws, data);
    }
}

function broadcastStatus(dn, payload) {
    const set = statusClients.get(dn);
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const ws of set) sendTo(ws, data);
}

function broadcastDomainEvent(dn, payload) {
    broadcastToDomain(dn, payload);
    broadcastStatus(dn, payload);
}

function dmSend(uid, payload) {
    const set = dmClients.get(uid);
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const ws of set) sendTo(ws, data);
}

module.exports = {
    discussClients, dmClients, statusClients,
    discussKey,
    registerDiscuss, unregisterDiscuss,
    registerDm, unregisterDm,
    registerStatus, unregisterStatus,
    sendTo,
    broadcastDiscuss, broadcastToDomain, broadcastStatus, broadcastDomainEvent, dmSend,
};
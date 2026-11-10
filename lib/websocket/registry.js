'use strict';
const discussClients = new Map();
const dmClients = new Map();
const statusClients = new Map();
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
function discussKey(dn, disc) { return `${dn}/${disc}`; }
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
function sendTo(ws, data) {
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        try { ws.close(1013, 'slow client'); } catch (e) {}
        return;
    }
    try { ws.send(data); } catch (e) {}
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
function forEachClient(fn) {
    for (const map of [discussClients, statusClients, dmClients]) {
        for (const set of map.values()) {
            for (const ws of Array.from(set)) fn(ws);
        }
    }
}
function closeSession(token) {
    if (!token) return 0;
    let count = 0;
    forEachClient(ws => {
        if (ws._token !== token) return;
        try { ws.close(4001, 'session ended'); } catch (e) {}
        count++;
    });
    return count;
}
function closeUser(uid) {
    if (!uid) return 0;
    let count = 0;
    forEachClient(ws => {
        if (String(ws._uid) !== String(uid)) return;
        try { ws.close(4001, 'session ended'); } catch (e) {}
        count++;
    });
    return count;
}
module.exports = {
    discussClients, dmClients, statusClients,
    MAX_BUFFERED_BYTES,
    discussKey,
    registerDiscuss, unregisterDiscuss,
    registerDm, unregisterDm,
    registerStatus, unregisterStatus,
    sendTo,
    broadcastDiscuss, broadcastToDomain, broadcastStatus, broadcastDomainEvent, dmSend,
    closeSession, closeUser,
};

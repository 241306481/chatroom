'use strict';
const logger = require('../logger');
const registry = require('./registry');

// ============================================================
// 从某个域的所有讨论中踢出用户
// ============================================================
function kickFromDomain(uid, dn) {
    const prefix = dn + '/';
    let count = 0;
    for (const [k, set] of registry.discussClients) {
        if (!k.startsWith(prefix)) continue;
        for (const ws of Array.from(set)) {
            if (ws._uid !== uid) continue;
            try { ws.send(JSON.stringify({ type: 'kicked', domain: dn, reason: '' })); } catch (e) {}
            try { ws.close(4001, 'Kicked'); } catch (e) {}
            count++;
        }
    }
    logger.kick(uid, dn, count);
    return count;
}

// ============================================================
// 从所有域踢出用户（用于全局封禁）
// ============================================================
function kickFromAllDomains(uid, reason) {
    let count = 0;
    for (const [k, set] of registry.discussClients) {
        for (const ws of Array.from(set)) {
            if (ws._uid !== uid) continue;
            try {
                ws.send(JSON.stringify({ type: 'kicked', domain: ws._dn, reason: reason || '' }));
            } catch (e) {}
            try { ws.close(4001, reason || 'Kicked'); } catch (e) {}
            count++;
        }
    }
    return count;
}

module.exports = { kickFromDomain, kickFromAllDomains };
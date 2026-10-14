'use strict';
const logger = require('../logger');
const registry = require('./registry');

// 关闭某个域内该用户的所有 socket。
// statusClients 必须一起处理：broadcastDomainEvent 会同时投递给 discussClients
// 和 statusClients，只关前者的话，被踢/被封的用户仍能收到 user_online/offline
// 与 members_update（后者是服务端渲染的完整成员名单 HTML）。
// 而且 status.js 的心跳复核救不回来——被踢后角色降为 guest，guest 仍带 PERM.VIEW，
// 复核永远判定通过。
function closeIn(set, uid, dn, reason) {
    let count = 0;
    for (const ws of Array.from(set || [])) {
        if (ws._uid !== uid) continue;
        try {
            ws.send(JSON.stringify({
                type: 'kicked', domain: dn || ws._dn, reason: reason || '',
            }));
        } catch (e) {}
        try { ws.close(4001, reason || 'Kicked'); } catch (e) {}
        count++;
    }
    return count;
}

// ============================================================
// 从某个域的所有讨论中踢出用户
// ============================================================
function kickFromDomain(uid, dn) {
    const prefix = dn + '/';
    let count = 0;
    for (const [k, set] of registry.discussClients) {
        if (!k.startsWith(prefix)) continue;
        count += closeIn(set, uid, dn, '');
    }
    count += closeIn(registry.statusClients.get(dn), uid, dn, '');
    logger.kick(uid, dn, count);
    return count;
}

// ============================================================
// 从所有域踢出用户（用于全局封禁）
// ============================================================
function kickFromAllDomains(uid, reason) {
    let count = 0;
    for (const set of registry.discussClients.values()) {
        count += closeIn(set, uid, null, reason);
    }
    for (const set of registry.statusClients.values()) {
        count += closeIn(set, uid, null, reason);
    }
    return count;
}

module.exports = { kickFromDomain, kickFromAllDomains };
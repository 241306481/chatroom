'use strict';
const logger = require('../logger');
const registry = require('./registry');
const ipBans = require('../storage/ip-bans');

// 按 IP 规则强制断开已建立的连接。
//
// 升级阶段（websocket/index.js）已经拦过 IP 封禁，但那只管「新连接」。
// 已经握手的 socket 不会因为之后新增的封禁而中断，而每条消息的
// refreshAuth 只复核账号封禁与域封禁、不看 IP —— 于是被封 IP 上仍然
// 开着的连接可以继续发消息/表情/删除，直到自然断开。
// WebSocket 是唯一能改状态的通道，这里不补上的话 IP 封禁对它形同虚设。
//
// rule 支持通配（'1.2.3.*'），所以必须用 ipBans.matchRule 而不是全等比较。
function kickByIpRule(rule, reason) {
    if (!rule) return 0;
    const hit = ip => {
        try { return ipBans.matchRule(ip, rule); }
        catch (e) { return false; }
    };
    let count = 0;
    for (const map of [registry.discussClients, registry.statusClients]) {
        for (const set of map.values()) {
            for (const ws of Array.from(set)) {
                if (!ws._ip || !hit(ws._ip)) continue;
                try { ws.send(JSON.stringify({ type: 'kicked', domain: ws._dn || '', reason: reason || '' })); } catch (e) {}
                try { ws.close(4003, reason || 'ip-banned'); } catch (e) {}
                count++;
            }
        }
    }
    for (const set of registry.dmClients.values()) {
        for (const ws of Array.from(set)) {
            if (!ws._ip || !hit(ws._ip)) continue;
            try { ws.send(JSON.stringify({ type: 'kicked', domain: '', reason: reason || '' })); } catch (e) {}
            try { ws.close(4003, reason || 'ip-banned'); } catch (e) {}
            count++;
        }
    }
    if (count > 0) logger.kick('ip:' + rule, '(ip-ban)', count);
    return count;
}

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

module.exports = { kickFromDomain, kickFromAllDomains, kickByIpRule };
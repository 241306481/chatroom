'use strict';
const logger = require('../logger');
const registry = require('./registry');
const ipBans = require('../storage/ip-bans');
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

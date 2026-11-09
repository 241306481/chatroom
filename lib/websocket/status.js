'use strict';
const storage = require('../storage');
const auth = require('../auth');
const registry = require('./registry');
const { PERM, hasPerm } = require('../permissions');
const { sessionValid } = require('./session-guard');
function onConnect(ws, { dn, user, ip, token, ua }) {
    ws._ip = ip;
    ws._uid = user.id;
    ws._dn = dn;
    ws._token = token;
    ws._ua = ua || '';
    registry.registerStatus(dn, ws);
    const onlineUids = storage.listRealUsers()
        .filter(u => storage.isOnline(u.id, dn))
        .map(u => u.id);
    ws.send(JSON.stringify({ type: 'online_list', users: onlineUids }));
    ws.on('message', raw => {
        let data; try { data = JSON.parse(raw.toString()); } catch (e) { return; }
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'ping') return;
        if (!sessionValid(ws, user.id)) {
            try { ws.close(4003, 'session ended'); } catch (e) {}
            return;
        }
        const fresh = storage.loadUser(user.id);
        if (!fresh || !fresh.id) return;
        if (ip && storage.isIpBanned(ip)) {
            try { ws.close(4003, 'ip-banned'); } catch (e) {}
            return;
        }
        if (auth.isUserBanned(fresh)) {
            try { ws.close(4003, 'banned'); } catch (e) {}
            return;
        }
        const domain = storage.loadDomain(dn);
        if (!domain.name || auth.isUserBannedInDomain(domain, fresh.id)) {
            try { ws.close(4003, 'domain-banned'); } catch (e) {}
            return;
        }
        if (!hasPerm(auth.getDomainUser(dn, fresh).perm, PERM.GENERAL.VIEW)) {
            try { ws.close(4003, 'no-permission'); } catch (e) {}
            return;
        }
        ws.send(JSON.stringify({ type: 'pong' }));
    });
    ws.on('close', () => {
        registry.unregisterStatus(dn, ws);
    });
}
module.exports = { onConnect };

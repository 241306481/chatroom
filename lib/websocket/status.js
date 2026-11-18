'use strict';
const storage = require('../storage');
const auth = require('../auth');
const registry = require('./registry');
const { PERM, hasPerm } = require('../permissions');
const { sessionValid } = require('./session-guard');
function reject(ws, reason) {
    try { ws.send(JSON.stringify({ type: 'error', reason, badge_only: true })); } catch (e) {}
    try { ws.close(4003, reason); } catch (e) {}
}
function onConnect(ws, { dn, user, ip, ipLocal, token, ua }) {
    ws._ip = ip;
    ws._ipLocal = ipLocal === true;
    ws._uid = user.id;
    ws._dn = dn;
    ws._token = token;
    ws._ua = ua || '';
    registry.registerStatus(dn, ws);
    ws.on('close', () => {
        registry.unregisterStatus(dn, ws);
    });
    ws.send(JSON.stringify({
        type: 'online_list',
        users: storage.listOnline(dn),
    }));
    ws.on('message', raw => {
        let data; try { data = JSON.parse(raw.toString()); } catch (e) { return; }
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'ping') return;
        if (!sessionValid(ws, user.id)) {
            reject(ws, 'session ended');
            return;
        }
        const fresh = storage.loadUser(user.id);
        if (!fresh || !fresh.id) return;
        if (ip && storage.isIpBanned(ip)) {
            reject(ws, 'ip-banned');
            return;
        }
        if (auth.isUserBanned(fresh)) {
            reject(ws, 'banned');
            return;
        }
        const domain = storage.loadDomain(dn);
        if (!domain.name || auth.isUserBannedInDomain(domain, fresh.id)) {
            reject(ws, 'domain-banned');
            return;
        }
        if (!hasPerm(auth.getDomainUser(dn, fresh).perm, PERM.GENERAL.VIEW)) {
            reject(ws, 'no-permission');
            return;
        }
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch (e) {}
    });
}
module.exports = { onConnect };

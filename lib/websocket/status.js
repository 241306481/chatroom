'use strict';
const storage = require('../storage');
const auth = require('../auth');
const registry = require('./registry');
const { PERM, hasPerm } = require('../permissions');

function onConnect(ws, { dn, user, ip }) {
    ws._ip = ip;
    ws._uid = user.id;
    ws._dn = dn;
    registry.registerStatus(dn, ws);

    // 初始化在线列表
    const onlineUids = storage.listRealUsers()
        .filter(u => storage.isOnline(u.id, dn))
        .map(u => u.id);
    ws.send(JSON.stringify({ type: 'online_list', users: onlineUids }));

    ws.on('message', raw => {
        let data; try { data = JSON.parse(raw.toString()); } catch (e) { return; }
        if (!data || typeof data !== 'object') return;
        if (data.type !== 'ping') return;
        const fresh = storage.loadUser(user.id);
        if (!fresh || !fresh.id) return;
        if (auth.isUserBanned(fresh)) {
            try { ws.close(4003, 'banned'); } catch (e) {}
            return;
        }
        const domain = storage.loadDomain(dn);
        if (!domain.name || auth.isUserBannedInDomain(domain, fresh.id)) {
            try { ws.close(4003, 'domain-banned'); } catch (e) {}
            return;
        }
        if (!hasPerm(auth.getDomainUser(dn, fresh).perm, PERM.VIEW)) {
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
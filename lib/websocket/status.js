'use strict';
const storage = require('../storage');
const registry = require('./registry');

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
        if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    });

    ws.on('close', () => {
        registry.unregisterStatus(dn, ws);
    });
}

module.exports = { onConnect };
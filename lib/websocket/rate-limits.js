'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');
const liveView = require('../rate-limit-view');
const registry = require('./registry');
const { sessionValid } = require('./session-guard');

function allowed(user) {
    return hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)
        || hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_RATE_LIMITS);
}
function snapshot() {
    const view = liveView.build();
    return {
        type: 'rate_limits',
        actions: view.actions,
        sessionCount: view.sessionCount,
    };
}
function onConnect(ws, { user, ip, ipLocal, token, ua }) {
    if (!user || !user.id || !allowed(user)) {
        try { ws.close(4003, 'no-permission'); } catch (e) {}
        return;
    }
    ws._ip = ip;
    ws._ipLocal = ipLocal === true;
    ws._token = token;
    ws._ua = ua || '';
    registry.registerRateLimit(ws);
    let ticks = 0;
    function cleanup() {
        clearInterval(timer);
        registry.unregisterRateLimit(ws);
    }
    function close(code, reason) {
        cleanup();
        try { ws.close(code, reason); } catch (e) {}
    }
    function send() {
        if (ws.readyState !== 1) return;
        if (ticks++ % 5 === 0) {
            if (!sessionValid(ws, user.id)) {
                close(4001, 'session ended');
                return;
            }
            const fresh = storage.loadUser(user.id);
            if (!fresh || !fresh.id || !allowed(fresh)) {
                close(4003, 'no-permission');
                return;
            }
        }
        try { ws.send(JSON.stringify(snapshot())); } catch (e) {}
    }
    const timer = setInterval(send, 1000);
    if (timer.unref) timer.unref();
    ws.on('close', cleanup);
    ws.on('error', cleanup);
    ws.on('message', raw => {
        let data; try { data = JSON.parse(raw.toString()); } catch (e) { return; }
        if (data && data.type === 'ping') send();
    });
    send();
}
module.exports = { onConnect, snapshot };

'use strict';
const storage = require('../storage');
const registry = require('./registry');
function currentAnnouncement() {
    try {
        const cfg = storage.loadDomain('system').system_config || {};
        return cfg.site_announcement || '';
    } catch (e) {
        return '';
    }
}
function onConnect(ws) {
    registry.registerSite(ws);
    ws.on('close', () => {
        registry.unregisterSite(ws);
    });
    try {
        ws.send(JSON.stringify({
            type: 'site_announcement',
            text: currentAnnouncement(),
        }));
    } catch (e) {}
}
module.exports = { onConnect, currentAnnouncement };

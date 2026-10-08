'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const storage = require('./lib/storage');
const routes = require('./lib/routes');
const websocket = require('./lib/websocket');

storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();

const CERT = path.join(__dirname, 'cert.pem');
const KEY = path.join(__dirname, 'key.pem');
const hasCert = fs.existsSync(CERT) && fs.existsSync(KEY);

const server = hasCert
    ? https.createServer({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }, routes.handleRequest)
    : http.createServer(routes.handleRequest);

websocket.setup(server);

function getLanIp() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '127.0.0.1';
}

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = '0.0.0.0';
const httpProto = hasCert ? 'https' : 'http';
const wsProto = hasCert ? 'wss' : 'ws';

server.listen(PORT, HOST, () => {
    const lanIp = getLanIp();
    console.log('==================================================');
    console.log('  Chatroom 2.0 starting...');
    console.log('==================================================');
    console.log(`  Protocol: ${httpProto} / ${wsProto}`);
    console.log(`  Listen  : ${HOST}:${PORT}`);
    console.log(`  LAN URL : ${httpProto}://${lanIp}:${PORT}`);
    console.log(`  Local   : ${httpProto}://127.0.0.1:${PORT}`);
    if (!hasCert) console.log('  Note    : cert.pem/key.pem 未找到，仅启用 HTTP/WS。');
    console.log('==================================================\n');
});

server.on('error', err => {
    console.error('[Server Error]', err.message);
    process.exit(1);
});
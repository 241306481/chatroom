'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('./lib/storage');
const routes = require('./lib/routes');
const websocket = require('./lib/websocket');
const startupCheck = require('./lib/startup-check');
const logger = require('./lib/logger');
const backup = require('./lib/backup');
const { registerShutdown } = require('./lib/graceful');
const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LINE = '--------------------------------------------------';
const RULE = '==================================================';
async function runStartupCheck() {
    const check = await startupCheck.run(__dirname, storage, { port: PORT, host: HOST });
    if (!check.results.length) return;
    console.log(LINE);
    console.log('  启动自检');
    console.log(LINE);
    for (const l of startupCheck.format(check)) console.log('  ' + l);
    console.log(LINE);
    if (!check.failed.length) return;
    const out = [`  启动自检未通过：${check.failed.map(f => f.name).join('、')}`];
    for (const f of check.failed) {
        if (f.detail) out.push(`    · ${f.name}：${f.detail}`);
    }
    out.push('  请修复上述问题后重试。');
    if (process.env.PORT) out.push(`  提示：当前 PORT=${process.env.PORT}，可用 "set PORT=xxxx" 换端口。`);
    try { fs.writeSync(1, out.join('\n') + '\n'); } catch (e) {}
    process.exit(1);
}
function configureServer(server) {
    server.requestTimeout = 5 * 60 * 1000;
    server.headersTimeout = 20 * 1000;
    server.keepAliveTimeout = 5 * 1000;
    server.maxHeadersCount = 100;
    server.on('clientError', (err, socket) => {
        if (!socket || socket.destroyed || !socket.writable) return;
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n'
            + 'Content-Length: 0\r\n\r\n');
    });
    return server;
}
function createServer() {
    const cert = path.join(__dirname, 'cert.pem');
    const key = path.join(__dirname, 'key.pem');
    if (!fs.existsSync(cert) || !fs.existsSync(key)) {
        return { server: configureServer(http.createServer(routes.handleRequest)), hasCert: false };
    }
    const server = https.createServer(
        { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
        routes.handleRequest);
    return { server: configureServer(server), hasCert: true };
}
function getLanIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return '127.0.0.1';
}
function printBanner(hasCert) {
    const proto = hasCert ? 'https' : 'http';
    const wsProto = hasCert ? 'wss' : 'ws';
    console.log(RULE);
    console.log('  Chatroom 2.0 starting...');
    console.log(RULE);
    console.log(`  Protocol: ${proto} / ${wsProto}`);
    console.log(`  Listen  : ${HOST}:${PORT}`);
    console.log(`  LAN URL : ${proto}://${getLanIp()}:${PORT}`);
    console.log(`  Local   : ${proto}://127.0.0.1:${PORT}`);
    if (!hasCert) {
        console.log('  Note    : cert.pem/key.pem 未找到，仅启用 HTTP/WS。');
        console.log('            运行 "npm run cert" 可生成自签名证书以启用 HTTPS/WSS。');
    }
    console.log(RULE + '\n');
}
function handleServerError(err) {
    console.error('[Server Error]', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error(`  端口 ${PORT} 已被占用。换端口：set PORT=xxxx 后重试。`);
    } else if (err.code === 'EACCES') {
        console.error(`  没有权限绑定 ${HOST}:${PORT}。1024 以下端口需要管理员权限。`);
    }
    process.exit(1);
}
async function main() {
    storage.ensureDirs();
    storage.ensureSystemDomain();
    storage.ensureSystemUser();
    await runStartupCheck();
    const { server, hasCert } = createServer();
    require('./lib/ws-protocol').setWsProtocol(hasCert ? 'wss' : 'ws');
    backup.init();
    registerShutdown(server, websocket.setup(server), {
        beforeExit: () => { backup.stop(); return backup.runNow('关机'); },
    });
    server.on('error', handleServerError);
    server.listen(PORT, HOST, () => printBanner(hasCert));
}
main();

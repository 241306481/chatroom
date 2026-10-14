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

// ============================================================
// 启动自检
// ============================================================
// 注意顺序：必须先把系统账户与 system 域建好再自检。
// 否则全新安装会因为「system 域缺失」被判为致命错误而拒绝启动 ——
// 那其实是正常的初始状态，不是故障。
storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();

const check = startupCheck.run(__dirname, storage);
if (check.results.length) {
    console.log('--------------------------------------------------');
    console.log('  启动自检');
    console.log('--------------------------------------------------');
    startupCheck.format(check).forEach(l => console.log('  ' + l));
    console.log('--------------------------------------------------');
    if (check.failed.length) {
        console.error(`  启动自检未通过：${check.failed.map(f => f.name).join('、')}`);
        console.error('  请修复上述问题后重试。');
        process.exit(1);
    }
}

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
const HOST = process.env.HOST || '0.0.0.0';
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
    if (!hasCert) {
        console.log('  Note    : cert.pem/key.pem 未找到，仅启用 HTTP/WS。');
        console.log('            运行 "npm run cert" 可生成自签名证书以启用 HTTPS/WSS。');
    }
    console.log('==================================================\n');
});

server.on('error', err => {
    console.error('[Server Error]', err.message);
    if (err.code === 'EADDRINUSE') {
        console.error(`  端口 ${PORT} 已被占用。换端口：set PORT=xxxx 后重试。`);
    } else if (err.code === 'EACCES') {
        console.error(`  没有权限绑定 ${HOST}:${PORT}。1024 以下端口需要管理员权限。`);
    }
    process.exit(1);
});

// ============================================================
// 优雅关闭
// ============================================================
// 之前只有 exp 模块自己注册了一个直接 process.exit 的钩子，
// 结果是：SIGTERM 到达时不关闭 server（连接悬空）、
// 不关闭 ws、不冲刷日志流、也不给正在处理的请求收尾时间。
// 现在统一在这里处理：
//   1. 停止接受新连接（server.close）
//   2. 给在途请求一个宽限期
//   3. 超时后强制退出，避免卡死在长连接上（WebSocket 是长连接，
//      必须靠超时兜底，否则永不退出）
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Shutdown] 收到 ${signal}，开始优雅关闭…`);

    const force = setTimeout(() => {
        console.error('[Shutdown] 超时，强制退出');
        process.exit(1);
    }, 8000);
    if (force.unref) force.unref();

    try {
        storage.flushExp && storage.flushExp();
    } catch (e) { /* 忽略 */ }

    server.close(() => {
        console.log('[Shutdown] HTTP 已关闭');
        clearTimeout(force);
        process.exit(0);
    });

    // 断开所有 WebSocket，否则它们会一直挂着阻止 server.close 回调触发
    try {
        const registry = require('./lib/websocket/registry');
        let n = 0;
        for (const map of [registry.discussClients, registry.statusClients, registry.dmClients]) {
            for (const set of map.values()) {
                for (const ws of Array.from(set)) {
                    try { ws.close(1001, 'server shutting down'); } catch (e) {}
                    n++;
                }
            }
        }
        if (n) console.log(`[Shutdown] 已关闭 ${n} 个 WebSocket`);
    } catch (e) { /* 忽略 */ }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// exp.js 自己也注册过 SIGINT/SIGTERM 的 process.once + exit，
// 这里 server 的处理会先关闭连接；两者不冲突（once 只触发一次）。
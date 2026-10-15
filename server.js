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

const PORT = parseInt(process.env.PORT || '5000', 10);
const HOST = process.env.HOST || '0.0.0.0';

storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();

(async () => {
    const check = await startupCheck.run(__dirname, storage, { port: PORT, host: HOST });
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

    const wsHandle = websocket.setup(server);

    let httpRequests = 0;
    server.on('request', () => { httpRequests++; });

    function getLanIp() {
        const ifaces = os.networkInterfaces();
        for (const name of Object.keys(ifaces)) {
            for (const iface of ifaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) return iface.address;
            }
        }
        return '127.0.0.1';
    }

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

    registerShutdown(server, wsHandle, logger, () => httpRequests);
})();

const FORCE_MS = 8000;
const WS_FRAME_GRACE_MS = 500;

function registerShutdown(server, wsHandle, logger, getHttpRequests) {
    let shuttingDown = false;

    function shutdown(signal) {
        // 幂等：连按两次 Ctrl+C 只处理第一次
        if (shuttingDown) return;
        shuttingDown = true;
        const t0 = Date.now();
        console.log(`\n[Shutdown] 收到 ${signal}，开始优雅关闭…`);

        const force = setTimeout(() => {
            console.error(`[Shutdown] 超时 ${FORCE_MS}ms，强制退出`);
            process.exit(1);
        }, FORCE_MS);

        // 1. 停止接受新连接
        server.close();

        // 2. 关闭空闲的 keep-alive 连接（Node >= 18.2）
        if (server.closeIdleConnections) server.closeIdleConnections();

        // 3. 关闭 WebSocket（模块内部负责摘 upgrade 监听 + 广播关闭帧）
        let closedWs = 0;
        try {
            if (wsHandle && typeof wsHandle.shutdown === 'function') {
                closedWs = wsHandle.shutdown() || 0;
            }
        } catch (e) {
            console.error('[Shutdown] WS 关闭异常:', e.message);
        }

        setTimeout(() => {
            if (server.closeAllConnections) server.closeAllConnections();

            // 5. 日志落盘
            Promise.resolve()
                .then(() => logger.close())
                .catch(() => {})
                .then(() => {
                    clearTimeout(force);
                    const took = Date.now() - t0;
                    const n = getHttpRequests();
                    const ws = closedWs === 1 ? 'connection' : 'connections';
                    const rq = n === 1 ? 'request' : 'requests';
                    console.log(`[Shutdown] closed ${closedWs} ws ${ws}, `
                        + `served ${n} HTTP ${rq}, took ${took}ms`);
                    process.exit(0);
                });
        }, closedWs > 0 ? WS_FRAME_GRACE_MS : 0);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

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
//
// PORT / HOST 必须在此之前取出：自检要预探端口占用，
// 而「端口被占」正是最该在 listen 之前就报出来的问题。
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

    // HTTP 请求计数，供关停时给出收尾统计。
    // createServer 的 handler 也是 'request' 监听器，Node 会依次调用两者，互不影响。
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

// ============================================================
// 优雅关闭
// ============================================================
// 之前只有 exp 模块自己注册了一个直接 process.exit 的钩子，
// 结果是：SIGTERM 到达时不关闭 server（连接悬空）、
// 不关闭 ws、不冲刷日志流、也不给正在处理的请求收尾时间。
// 现在统一在这里处理：
//   1. server.close()          停止接受新连接
//   2. closeIdleConnections()  放掉空闲 keep-alive（否则它们会把 server.close 的
//                              完成回调一直拖住，导致每次关停都吃满超时）
//   3. wsHandle.shutdown()     摘掉 upgrade 监听 + 广播 1001 关闭帧
//   4. 稍等片刻让关闭帧发出去，再 closeAllConnections() 强制收尾
//   5. logger.close()          等日志真正落盘（process.exit 不等 WriteStream）
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

        // 兜底：WebSocket 是长连接，任何一环卡住都可能导致永不退出。
        // 这里刻意**不** unref()：unref 后一旦进程因别的原因自然结束，
        // 这条超时诊断永远不会打印，关停会静默地以 exit(0) 结束。
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

        // 4. 让关闭帧发出去，再强制收尾。
        // 没有 WS 连接时不必空等 500ms。
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

// 说明：exp 的 pending 数据由 lib/auth/exp.js 自己的 process.once('exit') 处理，
// 这里**不要**再调 storage.flushExp —— storage 并不导出该函数，那行是死分支，
// 留着只会让人误以为关停时经验值是在这里冲刷的。
// 日志的 flush 则是 logger.close()（上面第 5 步），process.exit 不等 WriteStream，
// 必须显式 await。
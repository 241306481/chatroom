'use strict';
// 优雅关闭。
//
// Windows 关闭控制台窗口时，Node 会把 CTRL_CLOSE_EVENT 转发成 SIGHUP。
// 不监听的话进程被直接杀掉，日志来不及刷、缓冲数据会丢。

const logger = require('./logger');

// 强制退出兜底。Windows 关闭控制台窗口后只给约 5 秒，
// 这个值必须小于 5 秒，否则进程会被系统先杀掉。
const FORCE_MS = 4000;
// 等关闭帧发出
const WS_FRAME_GRACE_MS = 500;

function registerShutdown(server, wsHandle) {
    let httpRequests = 0;
    server.on('request', () => { httpRequests++; });

    let shuttingDown = false;
    function shutdown(signal) {
        if (shuttingDown) return;   // 幂等
        shuttingDown = true;
        const t0 = Date.now();
        console.log(`\n[Shutdown] 收到 ${signal}，开始优雅关闭…`);

        const force = setTimeout(() => {
            console.error(`[Shutdown] 超时 ${FORCE_MS}ms，强制退出`);
            process.exit(1);
        }, FORCE_MS);

        server.close();
        if (server.closeIdleConnections) server.closeIdleConnections();

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
            Promise.resolve()
                .then(() => logger.close())
                .catch(() => {})
                .then(() => {
                    clearTimeout(force);
                    const took = Date.now() - t0;
                    const ws = closedWs === 1 ? 'connection' : 'connections';
                    const rq = httpRequests === 1 ? 'request' : 'requests';
                    console.log(`[Shutdown] closed ${closedWs} ws ${ws}, `
                        + `served ${httpRequests} HTTP ${rq}, took ${took}ms`);
                    process.exit(0);
                });
        }, closedWs > 0 ? WS_FRAME_GRACE_MS : 0);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    // Windows 的 Ctrl+Break
    process.on('SIGBREAK', () => shutdown('SIGBREAK'));
    // SIGHUP：Windows 关闭控制台窗口时 Node 转发 CTRL_CLOSE_EVENT 为此信号
    process.on('SIGHUP', () => shutdown('SIGHUP'));

    // IPC 优雅停止：仅供测试与外部守护使用。
    // Windows 上 child.kill('SIGINT') 是强杀、不会触发处理器，
    // 跨平台测试只能走这条路，所以默认关闭（CHATROOM_IPC=1 才开）。
    if (process.send && process.env.CHATROOM_IPC === '1') {
        process.on('message', (msg) => {
            if (!msg || !msg.action) return;
            if (msg.action === 'GRACEFUL_STOP') shutdown('IPC');
        });
    }

    return { shutdown, isShuttingDown: () => shuttingDown };
}

module.exports = { registerShutdown, FORCE_MS, WS_FRAME_GRACE_MS };
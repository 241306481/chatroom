'use strict';
const logger = require('./logger');
const FORCE_MS = 4000;
const WS_FRAME_GRACE_MS = 500;
const HTTP_DRAIN_MS = 1500;
function registerShutdown(server, wsHandle, opts) {
    const beforeExit = opts && typeof opts.beforeExit === 'function' ? opts.beforeExit : null;
    let httpServed = 0;
    let httpActive = 0;
    server.on('request', (req, res) => {
        httpServed++;
        httpActive++;
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            httpActive--;
        };
        if (res && typeof res.once === 'function') {
            res.once('finish', finish);
            res.once('close', finish);
        } else {
            finish();
        }
    });
    let shuttingDown = false;
    let finished = false;
    function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        const t0 = Date.now();
        console.log(`\n[Shutdown] 收到 ${signal}，开始优雅关闭…`);
        const force = setTimeout(() => {
            console.error(`[Shutdown] 超时 ${FORCE_MS}ms，强制退出`);
            process.exit(1);
        }, FORCE_MS);
        server.close();
        if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
        let closedWs = 0;
        try {
            if (wsHandle) closedWs = wsHandle.shutdown() || 0;
        } catch (e) {
            console.error('[Shutdown] WS 关闭异常:', e.message);
        }
        const finish = () => {
            if (finished) return;
            finished = true;
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            let finishing = null;
            if (beforeExit) {
                finishing = Promise.resolve()
                    .then(() => beforeExit())
                    .catch(e => console.error('[Shutdown] 收尾任务异常:', e.message));
            }
            Promise.resolve(finishing)
                .then(() => logger.close())
                .catch(() => {})
                .then(() => {
                    clearTimeout(force);
                    const took = Date.now() - t0;
                    const ws = closedWs === 1 ? 'connection' : 'connections';
                    const rq = httpServed === 1 ? 'request' : 'requests';
                    console.log(`[Shutdown] closed ${closedWs} ws ${ws}, `
                        + `served ${httpServed} HTTP ${rq}, took ${took}ms`);
                    process.exit(0);
                });
        };
        const waitForDrain = () => {
            if (httpActive <= 0 || Date.now() - t0 >= HTTP_DRAIN_MS) {
                finish();
                return;
            }
            setTimeout(waitForDrain, 25);
        };
        setTimeout(waitForDrain, closedWs > 0 ? WS_FRAME_GRACE_MS : 0);
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGBREAK', () => shutdown('SIGBREAK'));
    process.on('SIGHUP', () => shutdown('SIGHUP'));
    if (process.send && process.env.CHATROOM_IPC === '1') {
        process.on('message', (msg) => {
            if (!msg || !msg.action) return;
            if (msg.action === 'GRACEFUL_STOP') shutdown('IPC');
        });
    }
    return { shutdown, isShuttingDown: () => shuttingDown };
}
module.exports = { registerShutdown, FORCE_MS, WS_FRAME_GRACE_MS };

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { fork } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
const gracefulSrc = fs.readFileSync(path.join(ROOT, 'lib/graceful.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
(async () => {
await check('注册了 SIGHUP 处理器', () => {
    assert.ok(/process\.on\('SIGHUP'/.test(gracefulSrc),
        'Windows 关闭控制台窗口时 Node 转发 CTRL_CLOSE_EVENT 为 SIGHUP，必须监听');
});
await check('SIGHUP 走的是同一套优雅关闭逻辑', () => {
    const m = /process\.on\('SIGHUP',\s*\(\)\s*=>\s*shutdown\('([^']+)'\)\)/.exec(gracefulSrc);
    assert.ok(m, 'SIGHUP 应调用 shutdown()');
    assert.strictEqual(m[1], 'SIGHUP');
});
await check('其它信号也都接了', () => {
    for (const sig of ['SIGTERM', 'SIGINT', 'SIGBREAK']) {
        assert.ok(gracefulSrc.includes("process.on('" + sig + "'"), sig + ' 未注册');
    }
});
await check('强制退出超时小于 Windows 的 5 秒宽限期', () => {
    const m = /const FORCE_MS\s*=\s*(\d+)/.exec(gracefulSrc);
    assert.ok(m, '应定义 FORCE_MS');
    assert.ok(parseInt(m[1], 10) < 5000, 'FORCE_MS 应小于 5000，实际 ' + m[1]);
});
await check('关闭流程会刷日志（logger.close）', () => {
    assert.ok(/logger\.close\(\)/.test(gracefulSrc), '关闭时应刷日志');
});
await check('关闭流程会关 WebSocket', () => {
    assert.ok(/wsHandle/.test(gracefulSrc) && /\.shutdown\(\)/.test(gracefulSrc),
        '关闭时应关 WS 连接');
});
await check('关闭是幂等的（重复信号不会重复执行）', () => {
    assert.ok(/if \(shuttingDown\) return;/.test(gracefulSrc), '应有关闭中的标记');
});
await check('支持 IPC 优雅停止（跨平台可测）', () => {
    assert.ok(/GRACEFUL_STOP/.test(gracefulSrc), '应支持 IPC 停止指令');
    assert.ok(/process\.on\('message'/.test(gracefulSrc), '应监听 IPC 消息');
});
await check('server.js 已改用 lib/graceful.js', () => {
    assert.ok(/require\('\.\/lib\/graceful'\)/.test(serverSrc));
    assert.ok(!/function registerShutdown/.test(serverSrc),
        'server.js 里不应有重复实现');
});
await check('没有残留看门狗/自拉起代码', () => {
    assert.ok(!/watchdog/i.test(serverSrc + gracefulSrc), '不应有看门狗');
    assert.ok(!fs.existsSync(path.join(ROOT, 'lib/watchdog.js')), 'watchdog.js 应已删除');
    assert.ok(!fs.existsSync(path.join(ROOT, 'lib/shutdown.js')), 'shutdown.js 应已删除');
});
await check('优雅关闭流程可跑通（关 server、关 WS、幂等）', () => {
    const { registerShutdown } = require('../../lib/graceful');
    const server = new EventEmitter();
    let closed = false;
    server.close = () => { closed = true; };
    server.closeIdleConnections = () => {};
    server.closeAllConnections = () => {};
    let wsClosed = 0;
    const wsHandle = { shutdown: () => { wsClosed = 1; return 1; } };
    const realExit = process.exit;
    process.exit = () => {};
    try {
        const handle = registerShutdown(server, wsHandle);
        assert.strictEqual(handle.isShuttingDown(), false, '初始不应在关闭中');
        handle.shutdown('SIGHUP');
        assert.strictEqual(handle.isShuttingDown(), true, '调用后应标记关闭中');
        assert.strictEqual(closed, true, '应调用 server.close()');
        assert.strictEqual(wsClosed, 1, '应关闭 WS');
        handle.shutdown('SIGHUP');
        assert.strictEqual(wsClosed, 1, '重复信号不应重复关闭');
    } finally {
        process.exit = realExit;
    }
});
await check('关闭后异步刷日志并 exit(0)', async () => {
    const { registerShutdown } = require('../../lib/graceful');
    const server = new EventEmitter();
    server.close = () => {};
    server.closeIdleConnections = () => {};
    server.closeAllConnections = () => {};
    const realExit = process.exit;
    let exitCode = null;
    process.exit = (c) => { exitCode = c; };
    try {
        const handle = registerShutdown(server, { shutdown: () => 0 });
        handle.shutdown('SIGHUP');
        await new Promise(r => setTimeout(r, 500));
        assert.strictEqual(exitCode, 0, '应以 exit(0) 退出，实际 ' + exitCode);
    } finally {
        process.exit = realExit;
    }
});
await check('真实服务收到 IPC 停止指令后优雅退出', async () => {
    const PORT = 18896;
    const child = fork(path.join(ROOT, 'server.js'), [], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, PORT: String(PORT), CHATROOM_IPC: '1' },
        windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const portUp = () => new Promise((resolve) => {
        const net = require('net');
        const sock = net.connect({ host: '127.0.0.1', port: PORT }, () => {
            sock.end(); resolve(true);
        });
        sock.on('error', () => resolve(false));
        sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
    });
    try {
        let started = false;
        for (let k = 0; k < 60; k++) {
            if (await portUp()) { started = true; break; }
            await sleep(300);
        }
        assert.ok(started, '服务未能启动: ' + out.slice(0, 300));
        child.send({ action: 'GRACEFUL_STOP' });
        let exited = false;
        for (let k = 0; k < 60; k++) {
            if (child.exitCode !== null || child.signalCode !== null) { exited = true; break; }
            await sleep(200);
        }
        assert.ok(exited, '未退出。out=' + out.slice(-300));
        assert.strictEqual(child.exitCode, 0, '应以 exit(0) 退出，实际 ' + child.exitCode);
        assert.ok(out.includes('[Shutdown] closed'),
            '应打出关闭日志，实际: ' + out.slice(-300));
    } finally {
        try { child.kill('SIGKILL'); } catch (e) {}
    }
});
console.log('\n======== [回归] 退出处理 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);})();

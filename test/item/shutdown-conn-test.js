'use strict';
// 复杂验证：带活跃连接时的优雅关闭
//   - HTTP 请求要计数
//   - WebSocket 连接要真正断开（收到 close 帧）
//   - 日志要刷盘
//   - 进程以 exit(0) 退出
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..', '..');
const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {

await check('活跃连接下优雅关闭：WS 断开 + HTTP 计数 + exit(0) + 日志刷盘', async () => {
    const PORT = 18895;
    const LOG_DIR = path.join(ROOT, 'logs');

    // 清掉旧日志，便于对比
    const beforeFiles = fs.existsSync(LOG_DIR)
        ? fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')) : [];
    const beforeSize = {};
    for (const f of beforeFiles) {
        beforeSize[f] = fs.statSync(path.join(LOG_DIR, f)).size;
    }

    const child = fork(path.join(ROOT, 'server.js'), [], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
            ...process.env,
            PORT: String(PORT),
            CHATROOM_IPC: '1',          // 开启 IPC 停止通道（仅测试用）
        },
        windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { out += d.toString(); });

    // 前面的 tls-test 可能生成了证书，服务会以 HTTPS 启动。
    // 先探测端口通不通，再决定用 http 还是 https。
    const portUp = () => new Promise((resolve) => {
        const net = require('net');
        const sock = net.connect({ host: '127.0.0.1', port: PORT }, () => {
            sock.end(); resolve(true);
        });
        sock.on('error', () => resolve(false));
        sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
    });

    let ws = null;
    let wsClosed = false;
    let wsCloseCode = null;
    const httpReqs = [];
    let cookie = '';

    try {
        // 等服务起来
        let started = false;
        for (let k = 0; k < 60; k++) {
            if (await portUp()) { started = true; break; }
            await sleep(300);
        }
        assert.ok(started, '服务未能启动: ' + out.slice(0, 300));

        // 确保 system/general 讨论存在（data 可能是全新建的）
        {
            const storage = require('../../lib/storage');
            storage.ensureDirs();
            storage.ensureSystemDomain();
            storage.ensureSystemUser();
            if (!storage.loadDiscussion('system', 'general').name) {
                storage.saveDiscussion('system', 'general', {
                    id: 'general', title: '综合讨论',
                    created_at: new Date().toISOString(),
                });
            }
        }

        // 判断服务端用的是 http 还是 https
        const isHttps = out.includes('Protocol: https');
        const http = isHttps ? require('https') : require('http');
        // 自签名证书，客户端放行
        const httpOpts = isHttps ? { rejectUnauthorized: false } : {};
        const wsProto = isHttps ? 'wss' : 'ws';

        // WS 要登录态。
        // 注意：token 存在服务端的会话表里，测试进程造不出来，
        // 必须走 HTTP 注册/登录拿（token 存在服务端会话表里，测试进程造不出）。
        // 测试从 127.0.0.1 连，本机豁免限流，不会被注册配额挡住。
        {
            const nickname = 'shut' + Date.now().toString().slice(-8);
            const body = 'nickname=' + encodeURIComponent(nickname)
                + '&password=' + encodeURIComponent('Passw0rd!123')
                + '&confirm_password=' + encodeURIComponent('Passw0rd!123');
            const reg = await new Promise((resolve) => {
                const req = http.request({
                    host: '127.0.0.1', port: PORT, path: '/register', method: 'POST',
                    ...httpOpts,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(body),
                    },
                }, (res) => {
                    res.resume();
                    res.on('end', () => {
                        resolve(res.headers['set-cookie'] || []);
                    });
                });
                req.end(body);
            });
            cookie = reg.map(c => c.split(';')[0]).join('; ');
            if (!cookie.includes('token=')) {
                console.log(out);
            }
            assert.ok(cookie.includes('token='), '注册应拿到 token');
        }

        // 建 2 个 WebSocket 连接
        const mkWs = () => new Promise((resolve, reject) => {
            const w = new WebSocket(wsProto + '://127.0.0.1:' + PORT
                + '/ws/discuss/system/general', {
                    headers: { Cookie: cookie },
                    rejectUnauthorized: false,   // 自签名证书
                });
            w.on('open', () => resolve(w));
            w.on('error', (e) => reject(new Error('WS 连接失败: ' + e.message
                + ' | 服务端输出: ' + out.slice(-300))));
            setTimeout(() => reject(new Error('WS 连接超时')), 5000);
        });
        ws = await mkWs();
        const ws2 = await mkWs();
        ws2.on('close', (code) => { wsClosed = true; wsCloseCode = code; });

        // 发几个 HTTP 请求
        const get = (p) => new Promise((resolve) => {
            let req;
            try {
                req = http.get({ host: '127.0.0.1', port: PORT, path: p,
                    headers: { Cookie: cookie }, ...httpOpts }, (res) => {
                    res.resume();
                    res.on('end', () => resolve(res.statusCode));
                });
            } catch (e) {
                resolve(0);   // 连接被关也算一次尝试
                return;
            }
            req.on('error', () => resolve(0));
            req.setTimeout(3000, () => { try { req.destroy(); } catch (e) {} resolve(0); });
        });
        for (let k = 0; k < 3; k++) {
            const st = await get('/home');
            httpReqs.push(st);
            await sleep(120);
        }

        // 请求 IPC 优雅停止
        child.send({ action: 'GRACEFUL_STOP' });

        // 等进程退出
        let exited = false;
        for (let k = 0; k < 80; k++) {
            if (child.exitCode !== null || child.signalCode !== null) { exited = true; break; }
            await sleep(200);
        }

        assert.ok(exited, '进程未退出。out=' + out.slice(-400)
            + ' httpReqs=' + JSON.stringify(httpReqs));
        assert.strictEqual(child.exitCode, 0,
            '应以 exit(0) 退出，实际 code=' + child.exitCode + ' signal=' + child.signalCode);

        // 关闭日志里应报告 WS 与 HTTP 数量
        const closedLine = out.split('\n').find(l => l.includes('[Shutdown] closed'));
        assert.ok(closedLine, '应有 [Shutdown] closed 行。out=' + out.slice(-400));

        const wsNum = parseInt((closedLine.match(/closed (\d+) ws/) || [])[1], 10);
        const httpNum = parseInt((closedLine.match(/served (\d+) HTTP/) || [])[1], 10);

        assert.ok(wsNum >= 2, '应关闭至少 2 个 WS 连接，实际 ' + wsNum);
        assert.ok(httpNum >= 3, '应统计至少 3 个 HTTP 请求，实际 ' + httpNum);
        assert.ok(wsClosed, '客户端应收到 WS close 事件');
        assert.ok(wsCloseCode === 1001 || wsCloseCode === 1000,
            'close code 应为 1001/1000，实际 ' + wsCloseCode);

        // 日志应已刷盘：文件在进程退出后仍有内容
        const afterFiles = fs.existsSync(LOG_DIR)
            ? fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')) : [];
        let grew = false;
        for (const f of afterFiles) {
            const size = fs.statSync(path.join(LOG_DIR, f)).size;
            if (beforeSize[f] === undefined || size > beforeSize[f]) grew = true;
        }
        assert.ok(grew, '日志应已刷盘（文件变大或有新文件）');
    } finally {
        try { if (ws) ws.close(); } catch (e) {}
        try { child.kill('SIGKILL'); } catch (e) {}
    }
});

console.log('\n======== [回归] 关闭（带连接） ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

})();
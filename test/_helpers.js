'use strict';
const net = require('net');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 等待端口真正可连接。
//
// 固定 sleep 是不可靠的：整套跑下来机器负载高时，server.js 可能还没
// 监听完，第一个请求就会 ECONNREFUSED；曾经因此反复出现偶发失败。
// 轮询到连接成功为止，比猜一个时间稳。
async function waitForServer(port, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const ok = await new Promise(res => {
            const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); res(true); });
            s.on('error', () => res(false));
        });
        if (ok) return true;
        await sleep(150);
    }
    throw new Error('server did not start on port ' + port);
}

// 纯 HTTP 部署路径的套件专用：一旦残留 cert.pem，server.js 会自动切到
// HTTPS，明文请求会被直接重置（socket hang up）。
function clearTlsArtifacts(root) {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['cert.pem', 'key.pem']) {
        const p = path.join(root, f);
        if (fs.existsSync(p)) fs.rmSync(p);
    }
}

module.exports = { sleep, waitForServer, clearTlsArtifacts };
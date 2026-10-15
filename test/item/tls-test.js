// [回归] TLS/HTTPS：证书生成 → 加载 → Secure Cookie → WSS
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const { WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const CERT = path.join(ROOT, 'cert.pem');
const KEY = path.join(ROOT, 'key.pem');
const PORT = 5192;

const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpsPost(p, body) {
    return new Promise((res, rej) => {
        const payload = Buffer.from(new URLSearchParams(body).toString());
        const r = https.request({
            host: '127.0.0.1', port: PORT, path: p, method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': payload.length,
            },
        }, x => {
            let d = ''; x.on('data', c => d += c);
            x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: d }));
        });
        r.on('error', rej); r.write(payload); r.end();
    });
}

(async () => {
    if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

    // ---- 生成证书 ----
    await check('★ npm run cert 可生成 cert.pem / key.pem', async () => {
        fs.rmSync(CERT, { force: true }); fs.rmSync(KEY, { force: true });
        const r = spawnSync(process.execPath, [path.join(ROOT, 'test/tools/gen-cert.js')],
            { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
        const out = (r.stdout || '') + (r.stderr || '');
        assert.ok(fs.existsSync(CERT), '未生成 cert.pem:\n' + out.slice(0, 400));
        assert.ok(fs.existsSync(KEY), '未生成 key.pem');
    });

    await check('证书内容合法（可被 TLS 栈解析）', () => {
        const { createPrivateKey, X509Certificate } = require('crypto');
        const key = createPrivateKey(fs.readFileSync(KEY));
        assert.ok(key, '私钥无法解析');
        const cert = new X509Certificate(fs.readFileSync(CERT));
        assert.ok(cert.subject, '证书无 subject');
    });

    await check('证书 SAN 含 localhost 与本机 IP', () => {
        const { X509Certificate } = require('crypto');
        const cert = new X509Certificate(fs.readFileSync(CERT));
        const san = cert.subjectAltName || '';
        assert.ok(/DNS:localhost/.test(san), 'SAN 缺 localhost: ' + san);
        assert.ok(/IP Address:127\.0\.0\.1/.test(san), 'SAN 缺 127.0.0.1: ' + san);
    });

    // ---- 启动 HTTPS ----
    if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
    const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT } });
    let boot = '';
    proc.stdout.on('data', d => { boot += d; });
    proc.stderr.on('data', () => {});
    // 等待端口真正就绪
    await new Promise(async (res) => {
        const net = require('net');
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
            const ok = await new Promise(r => {
                const s = net.connect({ host: '127.0.0.1', port: PORT }, () => { s.end(); r(true); });
                s.on('error', () => r(false));
            });
            if (ok) return res();
            await sleep(150);
        }
        res();
    });

    await check('★ 检测到证书后自动启用 HTTPS/WSS', () => {
        assert.ok(/Protocol: https \/ wss/.test(boot), '未切换到 https/wss:\n' + boot.slice(0, 400));
    });

    let cookie = '';
    await check('★ HTTPS 下会话 Cookie 带 Secure', async () => {
        const r = await httpsPost('/register',
            { nickname: 'tlsuser', password: 'pw123456', confirm_password: 'pw123456' });
        assert.strictEqual(r.status, 302, 'register 未成功');
        const sc = (r.headers['set-cookie'] || []).join('; ');
        cookie = sc.split(';')[0];
        assert.ok(/HttpOnly/.test(sc), '缺 HttpOnly: ' + sc);
        assert.ok(/SameSite=Lax/.test(sc), '缺 SameSite: ' + sc);
        assert.ok(/Secure/.test(sc), '★ 缺 Secure: ' + sc);
    });

    await check('HTTPS 监听器拒绝明文 HTTP', async () => {
        const refused = await new Promise(res => {
            const r = http.request({ host: '127.0.0.1', port: PORT, path: '/home' },
                () => res(false));
            r.on('error', () => res(true));
            r.end();
        });
        assert.ok(refused, 'TLS 端口接受了明文 HTTP');
    });

    await check('★ WSS 握手成功', async () => {
        const ws = new WebSocket(`wss://127.0.0.1:${PORT}/ws/status/system`,
            { headers: { Cookie: cookie }, rejectUnauthorized: false });
        const ok = await new Promise(r => {
            ws.on('open', () => r(true));
            ws.on('error', () => r(false));
            setTimeout(() => r(false), 5000);
        });
        assert.ok(ok, 'WSS 握手失败');
        ws.close();
    });

    await check('HTTP 部署下不设 Secure（否则浏览器丢弃 Cookie）', () => {
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/auth.js'), 'utf8');
        assert.ok(/isSecureRequest/.test(src), '缺少按协议判定的逻辑');
        assert.ok(/\$\{secure \? '; Secure' : ''\}/.test(src), 'Secure 未按条件附加');
        assert.ok(/req\.socket && req\.socket\.encrypted/.test(src),
            '未依据 socket.encrypted 判定');
    });

    proc.kill();
    await sleep(300);

    console.log('\n======== [回归] TLS / HTTPS ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    fs.rmSync(CERT, { force: true }); fs.rmSync(KEY, { force: true });
    process.exit(f ? 1 : 0);
})().catch(e => {
    console.error('SUITE ERROR', e && e.message);
    process.exit(2);
});
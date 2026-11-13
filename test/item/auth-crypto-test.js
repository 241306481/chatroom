'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const nacl = require('tweetnacl');
const { clearTlsArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
clearTlsArtifacts(ROOT);
const PORT = 5342;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
let procErr = '';
proc.stderr.on('data', (d) => { procErr += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const storage = require(path.join(ROOT, 'lib/storage'));
function req(method, p, { body, cookie, json, ct } = {}) {
    return new Promise((resolve, reject) => {
        const h = { Origin: 'http://127.0.0.1:' + PORT };
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (json) {
            payload = Buffer.from(JSON.stringify(json));
            h['Content-Type'] = ct || 'application/json';
            h['Content-Length'] = payload.length;
        } else if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            (res) => {
                let d = '';
                res.on('data', (c) => d += c);
                res.on('end', () => resolve({
                    status: res.statusCode, headers: res.headers, body: d,
                }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
function cookieOf(res) {
    return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}
function jsonOf(res) {
    try { return JSON.parse(res.body); }
    catch (e) { throw new Error('无效 JSON: ' + res.body); }
}
function encryptPayload(info, fields) {
    const serverKey = Buffer.from(info.public_key, 'base64');
    const clientKeys = nacl.box.keyPair();
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const message = Buffer.from(JSON.stringify(fields), 'utf8');
    const ciphertext = nacl.box(message, nonce, serverKey, clientKeys.secretKey);
    return {
        v: 1,
        alg: info.alg,
        client_public_key: Buffer.from(clientKeys.publicKey).toString('base64'),
        nonce: Buffer.from(nonce).toString('base64'),
        ciphertext: Buffer.from(ciphertext).toString('base64'),
    };
}
const results = [];
async function check(name, fn) {
    try {
        await fn();
        results.push(['PASS', name]);
    } catch (e) {
        results.push(['FAIL', name + ' -> ' + e.message]);
    }
}
(async () => {
    let ready = false;
    for (let i = 0; i < 80; i++) {
        try { await req('GET', '/login'); ready = true; break; }
        catch (e) { await sleep(300); }
    }
    if (!ready) throw new Error('服务器未就绪' + (procErr ? ': ' + procErr.slice(0, 200) : ''));
    let info;
    await check('公钥接口返回可用的 Curve25519 公钥', async () => {
        const r = await req('GET', '/api/auth/public-key');
        assert.strictEqual(r.status, 200);
        info = jsonOf(r);
        assert.strictEqual(info.ok, true);
        assert.strictEqual(info.alg, 'curve25519-xsalsa20-poly1305');
        assert.strictEqual(Buffer.from(info.public_key, 'base64').length,
            nacl.box.publicKeyLength);
        assert.ok(info.key_id);
    });
    await check('加密注册成功并建立会话', async () => {
        const payload = encryptPayload(info, {
            nickname: 'cryptouser', password: 'pw123456',
            confirm_password: 'pw123456', return_to: '/home',
        });
        const r = await req('POST', '/register', { json: payload });
        const j = jsonOf(r);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(j.ok, true, r.body);
        assert.strictEqual(j.redirect, '/home');
        assert.ok(cookieOf(r).includes('token='), '未下发会话 cookie');
        const u = storage.findUserByNickname('cryptouser');
        assert.ok(u && u.id, '用户未创建');
    });
    await check('加密登录成功并建立新会话', async () => {
        const payload = encryptPayload(info, {
            nickname: 'cryptouser', password: 'pw123456',
            remember: '1', return_to: '/home',
        });
        const r = await req('POST', '/login', { json: payload });
        const j = jsonOf(r);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(j.ok, true, r.body);
        assert.strictEqual(j.redirect, '/home');
        assert.ok(cookieOf(r).includes('token='), '未下发会话 cookie');
    });
    await check('密文被篡改时返回 400 且不建立会话', async () => {
        const payload = encryptPayload(info, {
            nickname: 'cryptouser', password: 'pw123456',
        });
        const bad = Buffer.from(payload.ciphertext, 'base64');
        bad[0] ^= 1;
        payload.ciphertext = bad.toString('base64');
        const r = await req('POST', '/login', { json: payload });
        assert.strictEqual(r.status, 400, r.body);
        assert.strictEqual(jsonOf(r).ok, false);
        assert.ok(!cookieOf(r).includes('token='), '不应下发会话 cookie');
    });
    await check('无效 JSON 加密请求被拒绝', async () => {
        const r = await req('POST', '/login', { json: { v: 1 } });
        assert.strictEqual(r.status, 400, r.body);
        assert.strictEqual(jsonOf(r).ok, false);
    });
    await check('明文登录仍保持兼容', async () => {
        const r = await req('POST', '/login', {
            body: { nickname: 'cryptouser', password: 'pw123456' },
        });
        const j = jsonOf(r);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(j.ok, true, r.body);
    });
    await check('登录/注册页加载加密脚本并明确提示局限', async () => {
        for (const p of ['/login', '/register']) {
            const r = await req('GET', p);
            assert.ok(r.body.includes('/static/js/vendor/nacl-fast.min.js'),
                p + ' 缺少 nacl 脚本');
            assert.ok(r.body.includes('/static/js/auth-crypto.js'),
                p + ' 缺少 auth-crypto 脚本');
            assert.ok(r.body.includes('data-submit-action="submitEncryptedAuth"'),
                p + ' 表单未接入加密提交');
            assert.ok(r.body.includes('不能替代 HTTPS'),
                p + ' 缺少安全局限提示');
        }
    });

    proc.kill();
    console.log('\n======== [回归] 登录/注册凭据加密 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const failed = results.filter((x) => x[0] === 'FAIL').length;
    console.log(results.length - failed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error(e);
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    proc.kill();
    process.exit(1);
});

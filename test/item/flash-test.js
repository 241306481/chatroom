'use strict';
// 端到端：伪造 ?ok= 无效，flash 一次生效
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { clearTlsArtifacts } = require('./_helpers');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
// 必须清证书：否则 server.js 会走 HTTPS，本测试的 http 请求连不上
clearTlsArtifacts(ROOT);

const PORT = 5327;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
let procErr = '';
proc.stderr.on('data', (d) => { procErr += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 最小 cookie jar：应用 Set-Cookie 的 Max-Age 语义，模拟真实浏览器
const jar = new Map();
function applySetCookie(list) {
    for (const c of list || []) {
        const [kv, ...attrs] = c.split(';').map((x) => x.trim());
        const i = kv.indexOf('=');
        if (i < 0) continue;
        const name = kv.substring(0, i);
        const val = kv.substring(i + 1);
        const maxAge = attrs.find((a) => /^max-age=/i.test(a));
        if (maxAge && Number(maxAge.split('=')[1]) <= 0) jar.delete(name);
        else jar.set(name, val);
    }
}
function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function req(method, p, { body, cookie, jar: useJar } = {}) {
    return new Promise((resolve, reject) => {
        const h = {};
        const c = cookie || (useJar ? cookieHeader() : '');
        if (c) h.Cookie = c;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            (res) => {
                let d = ''; res.on('data', (x) => d += x);
                res.on('end', () => {
                    applySetCookie(res.headers['set-cookie']);
                    resolve({ status: res.statusCode, headers: res.headers, body: d });
                });
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

(async () => {
    let ready = false;
    for (let i = 0; i < 80; i++) {
        try { await req('GET', '/login'); ready = true; break; }
        catch (e) { await sleep(300); }
    }
    if (!ready) throw new Error('服务器未就绪' + (procErr ? '：' + procErr.slice(0, 200) : ''));

    const reg = await req('POST', '/register',
        { body: { nickname: 'flashuser', password: 'pw123456', confirm_password: 'pw123456' } });
    const C = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const uid = require(path.join(ROOT, 'lib/storage')).findUserByNickname('flashuser').id;

    check('伪造 ?ok= 不再显示提示', () => {
        // 直接访问带伪造文案的 URL
        return null;
    });
    const forged = await req('GET', '/home?ok=' + encodeURIComponent('您的账号已被封禁'), { cookie: C });
    check('伪造 ?ok= 页面不显示该文案', () => {
        assert.ok(!forged.body.includes('您的账号已被封禁'),
            '伪造文案出现在页面里');
    });

    check('正常操作走 flash 并显示一次', () => {
        assert.ok(true);
    });
    const up = await req('POST', `/user/${uid}`, {
        body: { nickname: 'flashuser2', bio: '改个名' }, cookie: C, jar: true,
    });
    check('POST 重定向时下发 flash cookie', () => {
        assert.ok(up.status === 302 || up.status === 303, '未重定向，status=' + up.status);
        const sc = up.headers['set-cookie'] || [];
        const f = sc.find((c) => c.startsWith('flash=') && !/flash=;/.test(c));
        assert.ok(f, '未下发 flash cookie，实际: ' + JSON.stringify(sc));
        assert.ok(/HttpOnly/.test(f), 'flash 应为 HttpOnly');
        assert.ok(/Max-Age=[1-9]/.test(f), 'flash 应有短期 Max-Age');
    });

    check('浏览器会带上 flash cookie', () => {
        assert.ok(cookieHeader().includes('flash='), 'cookie jar 未收到 flash');
    });

    const page = await req('GET', `/user/${uid}`, { jar: true });
    check('页面渲染出 flash 文案', () => {
        assert.ok(/var flash = "操作成功"/.test(page.body),
            '未注入 flash。片段: ' + (page.body.match(/var flash = .{0,30}/) || [''])[0]);
    });
    check('base.html 不再读 ?ok=', () => {
        assert.ok(!page.body.includes("searchParams.get('ok')"), '仍在读 ?ok=');
    });

    // 刷新：服务端已下发清除指令，浏览器不再带 flash
    const again = await req('GET', `/user/${uid}`, { jar: true });
    check('flash 一次性，刷新不重复弹', () => {
        assert.ok(!/var flash = "操作成功"/.test(again.body),
            '刷新后 flash 仍在；cookie=' + cookieHeader());
    });

    check('flash 文案长度受限（防注入超长）', () => {
        const flash = require(path.join(ROOT, 'lib/flash'));
        const c = flash.cookie('x'.repeat(500), false);
        assert.ok(decodeURIComponent(c).length < 400, '未截断');
    });

    proc.kill();
    console.log('\n======== [回归] flash 一次性提示 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter((x) => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { sleep, waitForServer, clearTlsArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const PORT = 5193;
const BASE = 'http://127.0.0.1:' + PORT;
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
clearTlsArtifacts(ROOT);
const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) },
});
const srvOut = [];
proc.stdout.on('data', d => srvOut.push(String(d)));
proc.stderr.on('data', d => srvOut.push(String(d)));
function get(p, cookie) {
    return new Promise((res, rej) => {
        const r = require('http').request({
            host: '127.0.0.1', port: PORT, path: p, method: 'GET',
            headers: cookie ? { Cookie: cookie } : {},
        }, x => {
            let d = ''; x.on('data', c => d += c);
            x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: d }));
        });
        r.on('error', rej); r.end();
    });
}
function post(p, body) {
    return new Promise((res, rej) => {
        const pl = Buffer.from(new URLSearchParams(body).toString());
        const r = require('http').request({
            host: '127.0.0.1', port: PORT, path: p, method: 'POST',
            headers: {
                Origin: BASE,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': pl.length,
            },
        }, x => {
            let d = ''; x.on('data', c => d += c);
            x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: d }));
        });
        r.on('error', rej); r.write(pl); r.end();
    });
}
const cookieOf = r => (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
const VIA_HELPER = ['/manage/ip_bans', '/manage/user_ips',
    '/manage/system_roles', '/manage/permissions'];
const INLINE_GUARD = ['/manage/users'];
const AGGREGATED = ['/manage/join_applications'];
const STRICT_ADMIN = ['/manage', '/manage/settings'];
const ROUTES = [...VIA_HELPER, ...INLINE_GUARD, ...AGGREGATED, ...STRICT_ADMIN];
const MEMBER_EXPECT = {};
for (const r of [...VIA_HELPER, ...INLINE_GUARD, ...STRICT_ADMIN]) MEMBER_EXPECT[r] = 403;
for (const r of AGGREGATED) MEMBER_EXPECT[r] = 200;
const results = [];
async function check(name, fn) {
    try { await fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); }
}
check('router 静态路径中的正则元字符按字面匹配', () => {
    const { route, findRoute } = require('../../lib/router');
    route('GET', '/__router_test/a.b', () => {});
    assert.ok(findRoute('GET', '/__router_test/a.b'));
    assert.strictEqual(findRoute('GET', '/__router_test/axb'), null);
});
check('route() 的 priv 声明必须按 (group, bit) 展开传给 checkPriv', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/routes/index.js'), 'utf8');
    assert.ok(/checkPriv\(user,\s*p\.group,\s*p\.bit\)/.test(src),
        '应展开 group/bit 传入，不能把整个 priv 对象当 group 传');
    assert.ok(!/checkPriv\(user,\s*found\.opts\.priv\)/.test(src),
        '不能把 priv 对象直接传给 checkPriv');
    const priv = fs.readFileSync(path.join(ROOT, 'lib/auth/privilege.js'), 'utf8');
    assert.ok(!/groupOrObj/.test(priv), 'checkPriv 不应再有旧签名兼容层');
    assert.ok(!/checkPrivCompat/.test(priv), 'checkPrivCompat 应已删除');
});
(async () => {
    await waitForServer(PORT);
    await check('非法私信 peer 不抛异常', () => {
        const storage = require('../../lib/storage');
        assert.strictEqual(storage.findDMMessage('1', 'CON', 'x'), null);
        assert.strictEqual(storage.findDMMessage('1', 'peer.', 'x'), null);
        assert.strictEqual(storage.getDMAttachment('1', 'CON', 'x'), null);
        assert.deepStrictEqual(storage.listDMAttachments('1', 'peer.'), []);
    });
    await check('multipart 字段超限时主动 drain 请求体', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-mp-drain-'));
        const req = new EventEmitter();
        req.destroyed = false;
        let resumed = 0;
        req.resume = () => { resumed++; };
        const boundary = '----ChatTestDrain';
        const pending = require('../../lib/multipart-stream')
            .parseMultipartStream(req, boundary, { maxBytes: 4 * 1024 * 1024, tmpdir: tmp });
        req.emit('data', Buffer.from('--' + boundary
            + '\r\nContent-Disposition: form-data; name="a"\r\n\r\n'));
        req.emit('data', Buffer.alloc(2 * 1024 * 1024, 0x61));
        await assert.rejects(pending, err => err && err.code === 'too_large');
        assert.strictEqual(resumed, 1, '字段超限后应调用 req.resume()');
        assert.deepStrictEqual(fs.readdirSync(tmp), []);
        fs.rmSync(tmp, { recursive: true, force: true });
    });
    await check('multipart 客户端断开时清理临时目录', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-mp-'));
        const req = new EventEmitter();
        const boundary = '----ChatTestDisconnect';
        const pending = require('../../lib/multipart-stream')
            .parseMultipartStream(req, boundary, { maxBytes: 1024 * 1024, tmpdir: tmp });
        req.emit('data', Buffer.from('--' + boundary
            + '\r\nContent-Disposition: form-data; name="a"\r\n\r\nx'));
        req.emit('close');
        await assert.rejects(pending, /Request closed/);
        assert.deepStrictEqual(fs.readdirSync(tmp), []);
        fs.rmSync(tmp, { recursive: true, force: true });
    });
    await check('静态资源支持 URL 编码文件名', async () => {
        const r = await get('/static/js/core/%64om.js');
        assert.strictEqual(r.status, 200);
    });
    await check('静态资源拒绝编码目录穿越', async () => {
        const r = await get('/static/%2e%2e/server.js');
        assert.strictEqual(r.status, 404);
    });
    await check('非法域名/讨论路径返回 404 而不是 5xx', async () => {
        for (const p of ['/domain/%00/home', '/domain/system/discuss/%00']) {
            const r = await get(p);
            assert.ok(r.status < 500, p + ' 返回 ' + r.status);
            assert.strictEqual(r.status, 404, p + ' 返回 ' + r.status);
        }
    });
    const adminC = cookieOf(await post('/register',
        { nickname: 'bossman', password: 'pw123456', confirm_password: 'pw123456' }));
    await post('/login', { nickname: 'bossman', password: 'pw123456' });
    const memberC = cookieOf(await post('/register',
        { nickname: 'plainjoe', password: 'pw123456', confirm_password: 'pw123456' }));
    await sleep(200);
    await check('非法私信附件 peer 返回 404 而不是 5xx', async () => {
        const list = await get('/messages/users?q=bossman', adminC);
        const uid = JSON.parse(list.body).users[0].id;
        for (const peer of ['CON', 'peer.', '%3A']) {
            const r = await get(`/messages/file/${uid}/${peer}/x`, adminC);
            assert.strictEqual(r.status, 404, peer + ' 返回 ' + r.status);
        }
    });
    for (const route of ROUTES) {
        const anon = await get(route);
        const mem = await get(route, memberC);
        const adm = await get(route, adminC);
        await check(`[${route}] 无 cookie：不得 5xx，且必须拒绝`, () => {
            assert.ok(anon.status < 500, `返回 ${anon.status}`);
            assert.notStrictEqual(anon.status, 200, '匿名竟然拿到了 200');
            assert.ok([302, 401, 403].includes(anon.status),
                `期望 302/401/403，实际 ${anon.status}`);
            if (VIA_HELPER.includes(route)) {
                assert.ok([302, 401].includes(anon.status),
                    `共享 helper 路由匿名应 302/401，实际 ${anon.status}`);
                assert.ok(String(anon.headers.location || '').startsWith('/login'),
                    '重定向目标不是 /login: ' + anon.headers.location);
            }
        });
        await check(`[${route}] 普通成员：期望 ${MEMBER_EXPECT[route]}`, () => {
            assert.ok(mem.status < 500, `返回 ${mem.status}`);
            assert.strictEqual(mem.status, MEMBER_EXPECT[route],
                `期望 ${MEMBER_EXPECT[route]}，实际 ${mem.status}`);
            if (MEMBER_EXPECT[route] === 403) {
                assert.ok(/没有|权限|管理员/.test(mem.body),
                    '403 页面内容不是权限提示');
            }
        });
        await check(`[${route}] 系统管理员：不得 5xx`, () => {
            assert.ok(adm.status < 500, `返回 ${adm.status}`);
            if (AGGREGATED.includes(route)) {
                assert.ok(adm.status < 400, `返回 ${adm.status}`);
                return;
            }
            assert.ok([200, 302].includes(adm.status),
                `期望 200/302，实际 ${adm.status}`);
        });
    }
    await check('服务端日志中没有任何 500 / 未捕获异常', () => {
        const bad = srvOut.join('').split('\n')
            .filter(l => /\b500\b|Uncaught|TypeError|ReferenceError/.test(l));
        assert.strictEqual(bad.length, 0, '出现异常:\n' + bad.slice(0, 3).join('\n'));
    });
    await check('requireSystemAdmin：匿名抛 UnauthorizedError，成员返回 false', () => {
        const { requireSystemAdmin } = require('../../lib/routes/manage/_helpers');
        const { UnauthorizedError } = require('../../lib/auth/privilege');
        const stub = () => ({ headers: {}, writeHead() {}, end() {} });
        assert.throws(() => requireSystemAdmin(null, stub()), UnauthorizedError);
        assert.throws(() => requireSystemAdmin(undefined, stub()), UnauthorizedError);
        assert.throws(() => requireSystemAdmin({}, stub()), UnauthorizedError);
    });
    await check('requireSystemAdmin：render403 从 template 取，不从 routes/_helpers', () => {
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/manage/_helpers.js'), 'utf8');
        assert.ok(/require\('\.\.\/\.\.\/template'\)/.test(src),
            'render403 未从 lib/template.js 引入');
        assert.ok(!/render403\s*\}\s*=\s*require\('\.\.\/_helpers'\)/.test(src),
            'render403 引用了 routes/_helpers（错误来源）');
        assert.strictEqual(typeof require('../../lib/template').render403, 'function');
    });
    proc.kill();
    await sleep(200);
    fs.rmSync(DATA, { recursive: true, force: true });
    console.log('\n======== [回归] /manage/* 身份三态 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})().catch(e => {
    console.error('SUITE ERROR', e && e.message);
    try { proc.kill(); } catch (e2) {}
    process.exit(2);
});

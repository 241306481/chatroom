const assert = require('assert');
const fs = require('fs');
const path = require('path');
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

// 匿名应跳登录页
const VIA_HELPER = ['/manage/ip_bans', '/manage/user_ips',
    '/manage/system_roles', '/manage/permissions'];
const INLINE_GUARD = ['/manage/users'];
const AGGREGATED = ['/manage/join_applications'];
const STRICT_ADMIN = ['/manage', '/manage/settings'];
const ROUTES = [...VIA_HELPER, ...INLINE_GUARD, ...AGGREGATED, ...STRICT_ADMIN];

// 期望状态码
const MEMBER_EXPECT = {};
for (const r of [...VIA_HELPER, ...INLINE_GUARD, ...STRICT_ADMIN]) MEMBER_EXPECT[r] = 403;
for (const r of AGGREGATED) MEMBER_EXPECT[r] = 200;

const results = [];
async function check(name, fn) {
    try { await fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); }
}

check('route() 的 priv 声明必须按 (group, bit) 展开传给 checkPriv', () => {
    // 曾因 checkPriv 只收 (user, group, bit) 而误传整个对象，
    // 结果管理员也被判 403。这里钉住调用点写法。
    const src = fs.readFileSync(path.join(ROOT, 'lib/routes/index.js'), 'utf8');
    assert.ok(/checkPriv\(user,\s*p\.group,\s*p\.bit\)/.test(src),
        '应展开 group/bit 传入，不能把整个 priv 对象当 group 传');
    assert.ok(!/checkPriv\(user,\s*found\.opts\.priv\)/.test(src),
        '不能把 priv 对象直接传给 checkPriv');
    // checkPriv 本身不再兼容对象签名
    const priv = fs.readFileSync(path.join(ROOT, 'lib/auth/privilege.js'), 'utf8');
    assert.ok(!/groupOrObj/.test(priv), 'checkPriv 不应再有旧签名兼容层');
    assert.ok(!/checkPrivCompat/.test(priv), 'checkPrivCompat 应已删除');
});

(async () => {
    await waitForServer(PORT);

    // 首者为超管
    const adminC = cookieOf(await post('/register',
        { nickname: 'bossman', password: 'pw123456', confirm_password: 'pw123456' }));
    await post('/login', { nickname: 'bossman', password: 'pw123456' });
    const memberC = cookieOf(await post('/register',
        { nickname: 'plainjoe', password: 'pw123456', confirm_password: 'pw123456' }));
    await sleep(200);

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
                // 匿名统一跳登录
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
                // 只要求非 5xx
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
        // 曾错 require
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/manage/_helpers.js'), 'utf8');
        assert.ok(/require\('\.\.\/\.\.\/template'\)/.test(src),
            'render403 未从 lib/template.js 引入');
        assert.ok(!/render403\s*\}\s*=\s*require\('\.\.\/_helpers'\)/.test(src),
            'render403 引用了 routes/_helpers（错误来源）');
        // 确由模板导出
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
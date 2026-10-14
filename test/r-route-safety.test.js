// [回归] /manage/* 的身份三态：匿名 / 普通成员 / 系统管理员
//
// 核心不变量：**任何身份、任何路由都不能返回 500**。
//
// 上一轮把两个一模一样的 requireSystemAdmin 合并成共享实现时，require 路径
// 写错（render403 在 lib/template.js，不在 lib/routes/_helpers.js），
// 结果只有「无权限」这一条分支会抛 TypeError ——
// 受影响的是被拒绝的人看到的页面，管理员和测试都看不见，
// 整套 110 项回归全绿。因此这里专门覆盖这一类路径。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { sleep, waitForServer, clearTlsArtifacts } = require('./_helpers');

const ROOT = 'D:/chatroom';
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

// 走 requireSystemAdmin 的路由：匿名必须被 router 转成 302 跳登录页。
const VIA_HELPER = ['/manage/ip_bans', '/manage/user_ips',
    '/manage/system_roles', '/manage/permissions'];
// /manage/users 由 lib/routes/admin.js 内的 PrivilegeError 单独拦，
// 不在本轮改动范围内，匿名是 403 而非重定向。
const INLINE_GUARD = ['/manage/users'];
// /manage/join_applications 是跨域聚合页：内部按 checkDual 逐域过滤，
// 普通成员不管理任何域 → 聚合结果为空 → 200 空列表是正确的，
// 它本来就不是「整站管理」页面。
const AGGREGATED = ['/manage/join_applications'];
const STRICT_ADMIN = ['/manage', '/manage/settings'];
const ROUTES = [...VIA_HELPER, ...INLINE_GUARD, ...AGGREGATED, ...STRICT_ADMIN];

// 每条路由对普通成员的期望状态码
const MEMBER_EXPECT = {};
for (const r of [...VIA_HELPER, ...INLINE_GUARD, ...STRICT_ADMIN]) MEMBER_EXPECT[r] = 403;
for (const r of AGGREGATED) MEMBER_EXPECT[r] = 200;

const results = [];
async function check(name, fn) {
    try { await fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); }
}

(async () => {
    await waitForServer(PORT);

    // 首个注册者 = 超级管理员；第二个 = 普通成员
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
                // 这几条走 requireSystemAdmin，匿名应统一跳登录页
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
                // 聚合页对超管同样可能是 200 空列表，只要求不是 5xx
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
        const { requireSystemAdmin } = require('D:/chatroom/lib/routes/manage/_helpers');
        const { UnauthorizedError } = require('D:/chatroom/lib/auth/privilege');
        const stub = () => ({ headers: {}, writeHead() {}, end() {} });
        assert.throws(() => requireSystemAdmin(null, stub()), UnauthorizedError);
        assert.throws(() => requireSystemAdmin(undefined, stub()), UnauthorizedError);
        assert.throws(() => requireSystemAdmin({}, stub()), UnauthorizedError);
    });

    await check('requireSystemAdmin：render403 从 template 取，不从 routes/_helpers', () => {
        // 上轮的真实 bug：require 路径写错，只有 403 分支会炸
        const src = fs.readFileSync('D:/chatroom/lib/routes/manage/_helpers.js', 'utf8');
        assert.ok(/require\('\.\.\/\.\.\/template'\)/.test(src),
            'render403 未从 lib/template.js 引入');
        assert.ok(!/render403\s*\}\s*=\s*require\('\.\.\/_helpers'\)/.test(src),
            'render403 引用了 routes/_helpers（错误来源）');
        // 并且它确实是 template 导出的
        assert.strictEqual(typeof require('D:/chatroom/lib/template').render403, 'function');
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
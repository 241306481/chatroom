// 回归 3/4/6
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const PORT = 5191;
// 用 XFF 模拟外部 IP：本机地址已禁止封禁。
// 三段 IP 不重叠，避免把管理端自己封住
const FAKE_IP = '203.0.113.5';     // 被测用户，全程封禁
const ADMIN_IP = '198.18.0.1';     // 管理员
const SIDE_IP = '198.19.0.1';      // 「命中自己」实验的发起 IP，会被自己的规则命中
const SIDE2_IP = '198.20.0.1';     // 第二个实验，避免被上一条规则拦住
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT, TRUST_PROXY: '1' } });
proc.stdout.on('data', () => {});
proc.stderr.on('data', () => {});
const { sleep, waitForServer, clearTlsArtifacts } = require('./_helpers');

const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

function req(method, p, { body, cookie, xff } = {}) {
    return new Promise((resolve, reject) => {
        const h = {};
        if (cookie) h.Cookie = cookie;
        if (xff) h['X-Forwarded-For'] = xff;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            res => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
const cookieOf = r => (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
const tryOpen = ws => new Promise(r => {
    ws.on('open', () => r(true)); ws.on('error', () => r(false));
    setTimeout(() => r(false), 2500);
});

clearTlsArtifacts(ROOT);

(async () => {
    await waitForServer(PORT);
    const storage = require('../../lib/storage');
    const auth = require('../../lib/auth');

    const ROOT_C = cookieOf(await req('POST', '/register',
        { body: { nickname: 'rootbb', password: 'pw123456', confirm_password: 'pw123456' } }));
    const B = cookieOf(await req('POST', '/register',
        { body: { nickname: 'bobbb88', password: 'pw123456', confirm_password: 'pw123456' } }));
    await req('POST', '/register',
        { body: { nickname: 'carol88', password: 'pw123456', confirm_password: 'pw123456' } });
    const uidB = storage.findUserByNickname('bobbb88').id;
    const uidC = storage.findUserByNickname('carol88').id;

    // 规则增删走 HTTP：ip-bans 有 60 秒缓存，
    // 直接改文件不会让服务端失效，已删规则仍会拦请求
    const addRule = async (rule, extra) => req('POST', '/manage/ip_bans',
        { body: { action: 'add', rule, reason: 't', until: '', ...(extra || {}) },
            cookie: ROOT_C, xff: ADMIN_IP });
    const delRule = async (rule) => req('POST', '/manage/ip_bans',
        { body: { action: 'remove', rule }, cookie: ROOT_C, xff: ADMIN_IP });

    await check('#4 "2026-10-14T12:00"（无秒无 Z）被接受并规范化', () => {
        assert.strictEqual(auth.normalizeUntil('2026-10-14T12:00'), '2026-10-14T12:00:00Z');
    });
    await check('#4 三种输入形态归一化结果一致', () => {
        const a = auth.normalizeUntil('2026-10-14T12:00');
        const b = auth.normalizeUntil('2026-10-14T12:00Z');
        const c = auth.normalizeUntil('2026-10-14T12:00:00');
        const d = auth.normalizeUntil('2026-10-14T12:00:00Z');
        assert.strictEqual(a, b); assert.strictEqual(b, c); assert.strictEqual(c, d);
    });
    await check('#4 时区无关性（本机非 UTC，offset=' + new Date().getTimezoneOffset() + '）', () => {
        assert.strictEqual(auth.normalizeUntil('2026-10-14T12:00'),
            auth.normalizeUntil('2026-10-14T12:00Z'));
    });
    await check('#4 真正非法的日期仍被拒绝', () => {
        assert.strictEqual(auth.normalizeUntil('2026-13-01T12:00'), null);
        assert.strictEqual(auth.normalizeUntil('2024-02-30T12:00'), null);
        assert.strictEqual(auth.normalizeUntil('2099-99-99T99:99'), null);
        assert.strictEqual(auth.normalizeUntil('abc'), null);
    });
    await check('#4 与 auth 侧校验规则完全一致', () => {
        const ipb = require('../../lib/storage/ip-bans');
        for (const v of ['2026-10-14T12:00', '2099-06-01T12:00', '2024-02-30T12:00', 'abc']) {
            let ipbRes;
            try { ipb.addBan('10.4.4.4', { until: v }); ipbRes = 'ok'; ipb.removeByRule('10.4.4.4'); }
            catch (e) { ipbRes = 'reject'; }
            const authRes = auth.normalizeUntil(v) === null ? 'reject' : 'ok';
            assert.strictEqual(ipbRes, authRes, '不一致: ' + v);
        }
    });
    await check('#4 域内封禁接口接受无秒时间（走 HTTP）', async () => {
const r = await req('POST', '/domain/system/manage/user',
        { body: { action: 'ban', user_id: uidC, reason: 'tz', until: '2099-06-01T12:00' }, cookie: ROOT_C });
    const loc = String(r.headers.location || '');
    assert.ok(!loc.includes('error='), '域内封禁失败: ' + loc);
    // 提示改走 flash cookie，不再放 URL
    assert.ok(!loc.includes('ok='), '不应再有 ?ok=');
    const flashCookie = (r.headers['set-cookie'] || []).find((c) => /^flash=.+;/.test(c));
    assert.ok(flashCookie, '应下发 flash cookie');
    const ban = (storage.loadDomain('system').bans || {})[uidC];
    assert.strictEqual(ban.until, '2099-06-01T12:00:00Z', '到期值未规范化: ' + ban.until);
});

    // IP 封禁断 WS
    await check('#3 正常情况下 WS 可建立', async () => {
        const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
            { headers: { Cookie: B } });
        assert.ok(await tryOpen(w), 'WS 建不起来');
        w.close();
    });

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: B, 'X-Forwarded-For': FAKE_IP } });
    await tryOpen(ws);
    ws.send(JSON.stringify({ type: 'message', content: 'before ban' }));
    await sleep(600);

    const banRes = await req('POST', '/manage/ip_bans',
        { body: { action: 'add', rule: FAKE_IP, reason: 'r', until: '' }, cookie: ROOT_C });
    await sleep(400);

    await check('#3 封禁后 HTTP 被拒', async () => {
        const r = await req('GET', '/home', { cookie: B, xff: FAKE_IP });
        assert.strictEqual(r.status, 403, 'status ' + r.status);
    });
    await check('#3 封禁后未带该 IP 的请求仍正常', async () => {
        const r = await req('GET', '/home', { cookie: B });
        assert.ok(r.status !== 403, '其它 IP 不该被拦，status ' + r.status);
    });
    await check('#3 封禁后已建立的 WS 被主动断开', () => {
        assert.strictEqual(ws.readyState, 3, 'readyState=' + ws.readyState + '（仍为 1 表示未断开）');
    });
    await check('#3 被封 IP 无法再发言', async () => {
        try { ws.send(JSON.stringify({ type: 'message', content: 'after ban' })); } catch (e) {}
        await sleep(700);
        const mine = storage.loadAllMessages('system', 'general')
            .filter(m => m.user_id === uidB && !m.deleted).map(m => m.content);
        assert.ok(!mine.includes('after ban'), '被封 IP 仍成功发言: ' + JSON.stringify(mine));
    });
    await check('#3 封禁后页内直接提示，不再重定向', async () => {
        assert.ok(!banRes.headers.location, '不应有 location 头，实际: ' + banRes.headers.location);
        assert.ok(banRes.body.includes('已添加规则'), '响应体应含结果提示');
        assert.ok(banRes.body.includes(FAKE_IP), '响应体应回显规则');
    });
await check('#3 禁止封禁本机地址', async () => {
        const ipb = require('../../lib/storage/ip-bans');
        for (const bad of ['127.0.0.1', '127.*.*.*', '0.0.0.0', '*.*.*.*', '0.*.*.*']) {
            assert.throws(() => ipb.validateRule(bad), /本机|不能/, bad + ' 应被拒绝');
        }
        assert.strictEqual(ipb.validateRule('203.0.113.9'), true);
        assert.strictEqual(ipb.validateRule('1.2.3.*'), true);
    });

    await check('#3 规则格式支持数字、* 与区间', () => {
        const ipb = require('../../lib/storage/ip-bans');
        assert.strictEqual(ipb.validateRule('1.2.3.4'), true);
        assert.strictEqual(ipb.validateRule('1.2.3.*'), true);
        assert.strictEqual(ipb.validateRule('1.1.1-3.2'), true);
        assert.strictEqual(ipb.validateRule('1.2.3.1-9'), true);
        // 非法形式
        for (const bad of ['1.2.3', '1.2.3.256', '1.2.a.4', '1-300.2.3.4', '3-1.2.3.4']) {
            assert.throws(() => ipb.validateRule(bad), bad + ' 应被拒绝');
        }
        // 区间也要拦本机。127-200.*.* 按点拆只有 3 段，
// 会先被段数拦下，故用 4 段写法验证
        assert.throws(() => ipb.validateRule('0-255.1.1.1'), /本机/, '应被拒绝');
        assert.throws(() => ipb.validateRule('127-200.1.1.1'), /本机/, '应被拒绝');
        assert.throws(() => ipb.validateRule('127-200.*.*'), /4 段|本机/);
        assert.throws(() => ipb.validateRule('0-255.*.*'), /4 段|本机/);
        // 区间匹配
        assert.strictEqual(ipb.matchRule('192.168.5.77', '192.168.5.1-99'), true);
        assert.strictEqual(ipb.matchRule('192.168.5.200', '192.168.5.1-99'), false);
    });

    await check('#3 输入框下方有动态红字校验', async () => {
        const r = await req('GET', '/manage/ip_bans', { cookie: ROOT_C, xff: ADMIN_IP });
        assert.ok(r.body.includes('data-error-check'), 'IP 输入框未挂动态校验');
        assert.ok(r.body.includes('checkIpRule'), '缺少 checkIpRule');
        assert.ok(r.body.includes('会命中你自己'), '缺少命中自己的提示文案');
    });
    await check('#3 通配规则也能匹配', () => {
        const ipb = require('../../lib/storage/ip-bans');
        assert.strictEqual(ipb.matchRule('192.168.5.77', '192.168.5.*'), true);
        assert.strictEqual(ipb.matchRule('10.0.0.1', '192.168.5.*'), false);
    });

    await check('#3 可改封禁时长，页内提示而非重定向', async () => {
        const ipb = require('../../lib/storage/ip-bans');
        const r = await req('POST', '/manage/ip_bans', {
            body: { action: 'set_until', rule: FAKE_IP, until: '2099-12-31T23:59' },
            cookie: ROOT_C,
        });
        assert.ok(!r.headers.location, '改时长不应重定向');
        assert.ok(r.body.includes('已更新'), '应含提示，实际: ' + r.body.slice(0, 200));
        const rec = ipb.listAll().find((x) => x.rule === FAKE_IP);
        assert.strictEqual(rec.until, '2099-12-31T23:59:00Z');
    });

    await check('#3 过期规则被标记且不再生效', () => {
        const ipb = require('../../lib/storage/ip-bans');
        ipb.addBan('198.51.100.7', { until: '2000-01-01T00:00' });
        assert.strictEqual(ipb.isBanned('198.51.100.7'), null, '过期规则不应命中');
        const rec = ipb.listAll().find((x) => x.rule === '198.51.100.7');
        assert.strictEqual(ipb.isExpired(rec), true, '应标记为已过期');
        ipb.removeByRule('198.51.100.7');
    });

    await check('#3 过期规则在列表页黄底标出', async () => {
        await addRule('198.51.100.8', { until: '2000-01-01T00:00' });
        const r = await req('GET', '/manage/ip_bans', { cookie: ROOT_C, xff: ADMIN_IP });
        assert.ok(r.body.includes('row-expired'), '过期行应有 row-expired 类');
        assert.ok(r.body.includes('已过期'), '应显示已过期标签');
        await delRule('198.51.100.8');
    });

await check('#3 自封自己网段不拦，只警告', async () => {
        const r = await req('POST', '/manage/ip_bans',
            {
                body: { action: 'add', rule: '198.20.*.*', reason: '自封', until: '' },
                cookie: ROOT_C, xff: SIDE2_IP,
            });
        assert.ok(!r.headers.location, '不应重定向');
        assert.ok(r.body.includes('已添加规则 198.20.*.*'), '应允许添加，实际: '
            + (r.body.match(/已添加规则[^<]*/) || [''])[0]);
        assert.ok(/命中了你自己所在网段/.test(r.body), '应给出警告');
        // 解除要走管理端 IP，它不被这条规则覆盖
        await delRule('198.20.*.*');
    });

    await check('#3 过期规则仍标黄', async () => {
        await addRule('198.21.0.*', { until: '2000-01-01T00:00' });
        const r = await req('GET', '/manage/ip_bans', { cookie: ROOT_C, xff: '198.21.0.1' });
        assert.strictEqual(r.status, 200, '过期规则不该拦人，状态 ' + r.status);
        const row = (r.body.match(/<tr class="([^"]*)"[^>]*>\s*<td>\s*<code>198\.21\.0\.\*/) || [])[1] || '';
        assert.ok(/row-expired/.test(row), '过期行应标黄，实际 class="' + row + '"');
        await delRule('198.21.0.*');
    });

    await check('#3 用户最近 IP 页有返回系统管理与查看封禁入口', async () => {
        const r = await req('GET', '/manage/user_ips', { cookie: ROOT_C });
        assert.ok(r.body.includes('/manage"'), '缺返回系统管理');
        assert.ok(r.body.includes('/manage/ip_bans'), '缺查看 IP 封禁');
    });

    await check('#3 解封后不再拦截', async () => {
        await req('POST', '/manage/ip_bans',
            { body: { action: 'remove', rule: FAKE_IP }, cookie: ROOT_C });
        const r = await req('GET', '/home', { cookie: B, xff: FAKE_IP });
        assert.ok(r.status !== 403, '解封后仍被拦，status ' + r.status);
    });

    // 封禁时间时区
    await check('#4 datetime-local 无秒值在 IP 封禁管理链路同样被接受', () => {
        // IP 已封，改验存储
        const ipb = require('../../lib/storage/ip-bans');
        assert.doesNotThrow(() => {
            ipb.addBan('9.9.9.9', { until: '2099-06-01T12:00' });
        }, 'datetime-local 无秒格式被拒绝');
        const rec = ipb.listAll().find(r => r.rule === '9.9.9.9');
        assert.strictEqual(rec.until, '2099-06-01T12:00:00Z');
        ipb.removeByRule('9.9.9.9');
    });

    // 触屏菜单
    await check('#6 菜单点击可切换展开（不再直接跳走）', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/core/menu.js'), 'utf8');
        assert.ok(/classList\.toggle\('show'\)/.test(src), '按钮未切换菜单');
        assert.ok(!/location\.href = '\/user\/'/.test(src), '点击仍直接跳转，触屏打不开菜单');
    });
    await check('#6 存在点击外部关闭与 Escape 关闭', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/core/menu.js'), 'utf8');
        assert.ok(/document\.addEventListener\('click'/.test(src), '无点击外部关闭');
        assert.ok(/Escape/.test(src), '无 Escape 关闭');
    });
    await check('#6 下拉内仍有个人资料入口（功能未丢）', () => {
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/base.html'), 'utf8');
        assert.ok(tpl.includes('href="/user/{{ current_user.id }}"'), '缺少个人资料链接');
    });
    await check('#6 移动端视口可渲染（无 JS 报错依赖）', () => {
        // 只做静态断言
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/base.html'), 'utf8');
        assert.ok(/name="viewport"/.test(tpl), '缺少 viewport meta');
        assert.ok(tpl.includes('userMenuBtn') && tpl.includes('userDropdown'),
            '菜单元素缺失');
    });

    console.log('\n======== [回归 3/4/6] IP 封禁 / 时区 / 触屏 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    proc.kill();
    await sleep(300);
    process.exit(f ? 1 : 0);
})().catch(e => {
    console.error('SUITE ERROR', e && e.message);
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    proc.kill(); process.exit(2);
});
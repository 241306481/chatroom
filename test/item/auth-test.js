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
const proc = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
proc.stderr.on('data', () => {});
const { sleep, waitForServer, clearTlsArtifacts } = require('./_helpers');

const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

function req(method, p, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const h = {};
        if (cookie) h.Cookie = cookie;
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
        assert.ok(!loc.includes('error='), '接口报错: ' + loc);
        assert.ok(loc.includes('ok=1'), '未成功: ' + loc);
        const ban = (storage.loadDomain('system').bans || {})[uidC];
        assert.strictEqual(ban.until, '2099-06-01T12:00:00Z', '落库值未规范化: ' + ban.until);
    });

    // IP 封禁断 WS
    await check('#3 正常情况下 WS 可建立', async () => {
        const w = new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
            { headers: { Cookie: B } });
        assert.ok(await tryOpen(w), 'WS 建不起来');
        w.close();
    });

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: B } });
    await tryOpen(ws);
    ws.send(JSON.stringify({ type: 'message', content: 'before ban' }));
    await sleep(600);

    const banRes = await req('POST', '/manage/ip_bans',
        { body: { action: 'add', rule: '127.0.0.1', reason: 'r', until: '' }, cookie: ROOT_C });
    await sleep(400);

    await check('#3 封禁后 HTTP 被拒', async () => {
        const r = await req('GET', '/home', { cookie: B });
        assert.strictEqual(r.status, 403, 'status ' + r.status);
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
    await check('#3 封禁确认回显断开数量', () => {
        assert.ok(decodeURIComponent(banRes.headers.location || '').includes('在线连接'),
            'location=' + banRes.headers.location);
    });
    await check('#3 通配规则也能匹配', () => {
        const ipb = require('../../lib/storage/ip-bans');
        assert.strictEqual(ipb.matchRule('192.168.5.77', '192.168.5.*'), true);
        assert.strictEqual(ipb.matchRule('10.0.0.1', '192.168.5.*'), false);
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
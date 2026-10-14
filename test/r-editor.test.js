// [回归 1] 编辑器 / 讨论区 / 私信 基础流程（端到端，真实 HTTP + WebSocket）
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('D:/chatroom/node_modules/ws');

const ROOT = 'D:/chatroom';
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const PORT = 5190;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
const srvErr = [];
proc.stderr.on('data', d => srvErr.push(String(d)));
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
// 全量跑套件时机器较忙，WS 握手偶发超过 5s：放宽超时并带一次重试。
// 注意必须清理定时器，否则 open() 成功后残留的定时器仍会 rej。
function open(ws, ms = 15000) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => { ws.off('open', onOpen); ws.off('error', onErr); rej(new Error('ws timeout')); }, ms);
        const onOpen = () => { clearTimeout(t); ws.off('error', onErr); res(); };
        const onErr = e => { clearTimeout(t); ws.off('open', onOpen); rej(e); };
        ws.on('open', onOpen);
        ws.on('error', onErr);
    });
}
async function openRetry(makeWs, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
        const ws = makeWs();
        try { await open(ws); return ws; } catch (e) { last = e; await sleep(500); }
    }
    throw last;
}
function waitFor(ws, pred, ms = 10000) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => { ws.off('message', h); rej(new Error('timeout waiting for event')); }, ms);
        const h = raw => {
            let d; try { d = JSON.parse(raw.toString()); } catch (e) { return; }
            if (pred(d)) { clearTimeout(t); ws.off('message', h); res(d); }
        };
        ws.on('message', h);
    });
}

// 本套件测纯 HTTP 部署路径；若残留证书，server.js 会自动切到 HTTPS，
// 导致下面的明文请求被直接重置（socket hang up）。
clearTlsArtifacts('D:/chatroom');

(async () => {
    await waitForServer(PORT);
    const storage = require('D:/chatroom/lib/storage');

    const A = cookieOf(await req('POST', '/register',
        { body: { nickname: 'alice99', password: 'pw123456', confirm_password: 'pw123456' } }));
    const B = cookieOf(await req('POST', '/register',
        { body: { nickname: 'bobby99', password: 'pw123456', confirm_password: 'pw123456' } }));
    const uidA = storage.findUserByNickname('alice99').id;
    const uidB = storage.findUserByNickname('bobby99').id;

    // ---------------- 讨论区 ----------------
    const wsA = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: A } }));
    const wsB = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: B } }));

    await check('讨论区：WS 可建立', () => {
        assert.strictEqual(wsA.readyState, 1);
        assert.strictEqual(wsB.readyState, 1);
    });

    let msgId = null;
    await check('讨论区：发送消息并被对端收到', async () => {
        const p = waitFor(wsB, d => d.type === 'new_message' && d.message.content === 'hello world');
        wsA.send(JSON.stringify({ type: 'message', content: 'hello world' }));
        const d = await p;
        msgId = d.message.id;
        assert.ok(msgId, '缺少消息 id');
    });

    await check('讨论区：消息已落盘且内容正确', () => {
        const all = storage.loadAllMessages('system', 'general');
        const m = all.find(x => x.id === msgId);
        assert.ok(m, '消息未落库');
        assert.strictEqual(m.content, 'hello world');
    });

    await check('讨论区：表情回应', async () => {
        const p = waitFor(wsA, d => d.type === 'reaction' && d.added === true);
        wsB.send(JSON.stringify({ type: 'reaction', message_id: msgId, emoji: '👍' }));
        const d = await p;
        assert.strictEqual(d.count, 1);
    });

    await check('讨论区：置顶', async () => {
        const p = waitFor(wsB, d => d.type === 'message_pinned' && d.pinned === true);
        wsA.send(JSON.stringify({ type: 'pin', message_id: msgId }));
        await p;
        assert.strictEqual(storage.findMessage('system', 'general', msgId).pinned, true);
    });

    await check('讨论区：撤回（own）', async () => {
        wsA.send(JSON.stringify({ type: 'revoke', message_id: msgId }));
        await sleep(500);
        const m = storage.findMessage('system', 'general', msgId);
        assert.strictEqual(m.revoked, true, '撤回未生效');
    });

    await check('讨论区：删除（own）', async () => {
        const m2 = { id: 'del-me-1', user_id: uidA, nickname: 'alice99', content: 'x', created_at: storage.nowIso() };
        storage.appendMessage('system', 'general', m2);
        wsA.send(JSON.stringify({ type: 'delete', message_id: 'del-me-1' }));
        await sleep(500);
        assert.strictEqual(storage.findMessage('system', 'general', 'del-me-1').deleted, true);
    });

    await check('讨论区：经验立即反映在存储中（无缓冲）', async () => {
        // 用普通成员验证。alice 是首个注册用户（系统 root），其 level 被
        // 置为 ADMIN_LEVEL=99 作为管理员标记，按设计不参与经验结算。
        assert.strictEqual(storage.loadDomain('system').members[uidA].level, 99,
            '前提不成立：alice 应为 ADMIN_LEVEL');
        const before = storage.loadDomain('system').members[uidB].exp || 0;
        wsB.send(JSON.stringify({ type: 'message', content: 'earn some exp' }));
        await sleep(600);
        const after = storage.loadDomain('system').members[uidB].exp || 0;
        assert.strictEqual(after, before + 1,
            '发消息后经验未立即落盘: before=' + before + ' after=' + after);
    });

    await check('讨论区：置顶消息出现在域主页', async () => {
        const r = await req('GET', '/domain/system/home', { cookie: A });
        assert.strictEqual(r.status, 200);
    });

    wsA.close(); wsB.close();

    // ---------------- 私信 ----------------
    const dmA = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/dm`, { headers: { Cookie: A } }));
    const dmB = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/dm`, { headers: { Cookie: B } }));

    await check('私信：发送并被对端收到', async () => {
        const p = waitFor(dmB, d => d.type === 'dm_new' && d.message.content === 'psst');
        dmA.send(JSON.stringify({ type: 'dm_send', target: uidB, content: 'psst' }));
        const d = await p;
        assert.strictEqual(d.message.from, uidA);
    });

    await check('私信：已落盘', () => {
        const msgs = storage.loadAllDM(uidA, uidB);
        assert.ok(msgs.some(m => m.content === 'psst'), '私信未落库');
    });

    await check('私信：未读计数与已读标记', async () => {
        assert.ok(storage.getTotalUnread(uidB) >= 1, 'B 没有未读');
        dmB.send(JSON.stringify({ type: 'dm_read', target: uidA }));
        await sleep(500);
        assert.strictEqual(storage.getTotalUnread(uidB), 0, '标记已读后仍有未读');
    });

    await check('私信：dm_read 对不存在的用户不写盘', async () => {
        const before = fs.readdirSync(path.join(DATA, 'users')).length;
        dmA.send(JSON.stringify({ type: 'dm_read', target: '../../evil' }));
        await sleep(400);
        const after = fs.readdirSync(path.join(DATA, 'users'));
        assert.ok(!after.includes('evil'), '写到了非法路径');
        assert.ok(after.length >= before);
    });

    await check('私信：/messages 页可访问', async () => {
        const r = await req('GET', '/messages?target=' + uidB, { cookie: A });
        assert.strictEqual(r.status, 200);
    });
    dmA.close(); dmB.close();

    // ---------------- 编辑器（前端产物 + 模板契约） ----------------
    await check('编辑器：模板与 JS 的选择器契约一致', () => {
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/context_edit.html'), 'utf8');
        for (const sel of ['data-wrapper', 'data-resize', 'data-pane="edit"',
            'data-pane="preview"', 'md-editor-preview', 'md-editor-counter']) {
            assert.ok(tpl.includes(sel), '模板缺少 ' + sel);
        }
        const js = fs.readFileSync(path.join(ROOT, 'static/js/editor/index.js'), 'utf8');
        for (const sel of ['[data-wrapper]', '[data-resize]', '[data-pane="edit"]']) {
            assert.ok(js.includes(sel), 'JS 未查询 ' + sel);
        }
    });

    await check('编辑器：预览兜底分支已转义（无 XSS）', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/editor/preview.js'), 'utf8');
        assert.ok(/esc\(ta\.value\)/.test(src), 'preview 兜底未转义');
    });

    await check('编辑器：Markdown 转义兜底一致', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/core/dom.js'), 'utf8');
        assert.ok(/esc\(raw\)/.test(src), 'toggleSource 兜底未转义');
    });

    await check('编辑器：jsdump 注入到 script 的负载已转义', () => {
        const { env } = require('D:/chatroom/lib/template.js');
        const out = env.renderString('x={{ v | jsdump }}', { v: '</script><img src=x onerror=1>' });
        assert.ok(!out.includes('</script>'));
    });

    await check('编辑器：插入链接后光标位置正确（走 insertAt）', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/editor/toolbar.js'), 'utf8');
        const seg = src.slice(src.indexOf("action === 'link'"), src.indexOf("action === 'image-link'"));
        assert.ok(/U\.insertAt\(ta, '\[' \+ sel/.test(seg), '链接插入未走 insertAt');
    });

    await check('编辑器：光标在 0 时的行前缀计算正确', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/editor/utils.js'), 'utf8');
        assert.ok(/const ls = s === 0 \? 0 : v\.lastIndexOf/.test(src));
    });

    const errs = srvErr.filter(x => /TypeError|ReferenceError|Cannot read/.test(x));
    await check('全流程无服务端异常', () => {
        assert.strictEqual(errs.length, 0, errs.slice(0, 2).join(' | '));
    });

    console.log('\n======== [回归 1] 编辑器/讨论区/私信 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    proc.kill();
    await sleep(300);
    process.exit(f ? 1 : 0);
})().catch(e => {
    console.error('SUITE ERROR', e && e.message);
    console.log(results.map(r => r.join(' ')).join('\n'));
    proc.kill();
    process.exit(2);
});
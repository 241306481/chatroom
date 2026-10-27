const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const ROOT = path.join(__dirname, '..', '..');
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
clearTlsArtifacts(ROOT);
(async () => {
    await waitForServer(PORT);
    const storage = require('../../lib/storage');
    const A = cookieOf(await req('POST', '/register',
        { body: { nickname: 'alice99', password: 'pw123456', confirm_password: 'pw123456' } }));
    const B = cookieOf(await req('POST', '/register',
        { body: { nickname: 'bobby99', password: 'pw123456', confirm_password: 'pw123456' } }));
    const uidA = storage.findUserByNickname('alice99').id;
    const uidB = storage.findUserByNickname('bobby99').id;
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
        const p = waitFor(wsB, d => d.type === 'message_revoked' && d.message_id === msgId);
        wsA.send(JSON.stringify({ type: 'revoke', message_id: msgId }));
        const d = await p;
        assert.strictEqual(d.revoked_by, uidA);
        assert.strictEqual(d.content, undefined, '撤回广播包含原文');
        assert.strictEqual(d.message, undefined, '撤回广播包含消息对象');
        assert.ok(!JSON.stringify(d).includes('hello world'), '撤回广播泄露原文');
        const m = storage.findMessage('system', 'general', msgId);
        assert.strictEqual(m.revoked, true, '撤回未生效');
    });
    await check('讨论区：撤回提示不按普通消息排版', () => {
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/discuss.html'), 'utf8');
        const msgJs = fs.readFileSync(path.join(ROOT, 'static/js/chat/render-message.js'), 'utf8');
        const actJs = fs.readFileSync(path.join(ROOT, 'static/js/chat/render-actions.js'), 'utf8');
        const css = fs.readFileSync(path.join(ROOT, 'static/css/discuss.css'), 'utf8');
        assert.ok(tpl.includes('revoked-msg'), '模板缺少 revoked-msg');
        assert.ok(tpl.includes('class="revoked-nick" href="/user/'), '模板撤回昵称缺少用户链接');
        assert.ok(!tpl.includes('msg.revoked_by or msg.user_id'), '模板保留兼容回退');
        assert.ok(msgJs.includes("classList.add('revoked-msg')"), '消息渲染缺少 revoked-msg');
        assert.ok(msgJs.includes('class="revoked-nick" href="/user/'), '消息渲染撤回昵称缺少用户链接');
        assert.ok(!msgJs.includes('msg.revoked_by || msg.user_id'), '消息渲染保留兼容回退');
        assert.ok(actJs.includes("classList.add('revoked-msg')"), '撤回更新缺少 revoked-msg');
        assert.ok(actJs.includes('class="revoked-nick" href="/user/'), '撤回更新昵称缺少用户链接');
        assert.ok(css.includes('.message.revoked-msg .msg-header > :not(.msg-actions)'),
            '撤回提示未隐藏消息头内容');
        assert.ok(!/\.msg-revoked \.revoked-nick:hover\s*\{[^}]*underline/.test(css),
            '撤回昵称链接仍有下划线');
    });
    await check('讨论区：撤回后接口不返回原文', async () => {
        const r = await req('GET',
            '/domain/system/discuss/general/messages?limit=50&offset=0', { cookie: A });
        assert.strictEqual(r.status, 200);
        assert.ok(!r.body.includes('hello world'), '消息接口泄露撤回原文');
        const data = JSON.parse(r.body);
        const m = data.messages.find(x => x.id === msgId);
        assert.ok(m, '撤回消息缺失');
        assert.strictEqual(m.revoked, true);
        assert.strictEqual(m.content, '');
        assert.strictEqual(m.reply_to, '');
        assert.strictEqual(m.reply_info, null);
        assert.strictEqual(m.reactions_json, '{}');
        assert.deepStrictEqual(m.mentions, []);
        assert.strictEqual(m.revoked_by, uidA);
        assert.strictEqual(m.revoked_by_nickname, 'alice99');
    });
    await check('讨论区：撤回后页面不泄露原文且有用户链接', async () => {
        const r = await req('GET', '/domain/system/discuss/general', { cookie: A });
        assert.strictEqual(r.status, 200);
        assert.ok(!r.body.includes('hello world'), '页面泄露撤回原文');
        assert.ok(r.body.includes('撤回了一条消息'));
        assert.ok(r.body.includes('class="revoked-nick" href="/user/' + uidA + '"'),
            '撤回提示缺少用户链接');
    });
    await check('讨论区：回复撤回消息不携带原文', async () => {
        const p = waitFor(wsA, d => d.type === 'new_message' && d.message.reply_to === msgId);
        wsB.send(JSON.stringify({
            type: 'message', content: 'reply after revoke', reply_to: msgId,
        }));
        const d = await p;
        assert.deepStrictEqual(d.message.reply_info, { id: msgId, revoked: true });
        assert.ok(!JSON.stringify(d.message).includes('hello world'), '回复信息泄露撤回原文');
    });
    await check('讨论区：撤回后不可置顶或回应', async () => {
        const before = JSON.stringify(storage.findMessage('system', 'general', msgId).reactions || {});
        wsA.send(JSON.stringify({ type: 'pin', message_id: msgId }));
        wsA.send(JSON.stringify({ type: 'reaction', message_id: msgId, emoji: '👍' }));
        await sleep(400);
        const m = storage.findMessage('system', 'general', msgId);
        assert.strictEqual(m.pinned, false, '撤回消息被重新置顶');
        assert.strictEqual(JSON.stringify(m.reactions || {}), before, '撤回消息仍可添加回应');
    });
    await check('讨论区：删除（own）', async () => {
        const m2 = { id: 'del-me-1', user_id: uidA, nickname: 'alice99', content: 'x', created_at: storage.nowIso() };
        storage.appendMessage('system', 'general', m2);
        wsA.send(JSON.stringify({ type: 'delete', message_id: 'del-me-1' }));
        await sleep(500);
        assert.strictEqual(storage.findMessage('system', 'general', 'del-me-1').deleted, true);
    });
await check('讨论区：经验立即反映在存储中（无缓冲）', async () => {
          const lvA = storage.loadDomain('system').members[uidA].level || 0;
          assert.ok(lvA !== 99, '存储中不应存在 ADMIN_LEVEL 哨兵，实际 level=' + lvA);
          const before = storage.loadDomain('system').members[uidB].exp || 0;
          wsB.send(JSON.stringify({ type: 'message', content: 'earn some exp' }));
          await sleep(600);
          const after = storage.loadDomain('system').members[uidB].exp || 0;
          assert.strictEqual(after, before + 1,
              '发消息后经验未即时落盘: before=' + before + ' after=' + after);
      });
    await check('讨论区：置顶消息出现在域主页', async () => {
        const r = await req('GET', '/domain/system/home', { cookie: A });
        assert.strictEqual(r.status, 200);
    });
    wsA.close(); wsB.close();
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
    await check('编辑器：预览统一使用 Markdown 渲染', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/editor/preview.js'), 'utf8');
        assert.ok(/tpl\.innerHTML = window\.renderContent\(text\)/.test(src),
            'preview 未使用统一渲染');
        assert.ok(!/esc\(ta\.value\)/.test(src), 'preview 仍保留兼容兜底');
    });
    await check('编辑器：预览按顶层节点增量更新', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/editor/preview.js'), 'utf8');
        assert.ok(/function patchNodes/.test(src), 'preview 缺少节点 diff');
        assert.ok(/preview\.insertBefore/.test(src), 'preview 未插入变化节点');
        assert.ok(!/preview\.innerHTML\s*=/.test(src), 'preview 仍在全量重载');
    });
    await check('编辑器：Markdown 转义兜底一致', () => {
        const src = fs.readFileSync(path.join(ROOT, 'static/js/core/dom.js'), 'utf8');
        assert.ok(/esc\(raw\)/.test(src), 'toggleSource 兜底未转义');
    });
    await check('编辑器：jsdump 注入到 script 的负载已转义', () => {
        const { env } = require('../../lib/template.js');
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

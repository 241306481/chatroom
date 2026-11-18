const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { sleep, waitForServer, clearTestArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
clearTestArtifacts(ROOT);
const PORT = 5197;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
const srvErr = [];
proc.stderr.on('data', d => srvErr.push(String(d)));
const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
function req(method, p, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const h = { Origin: 'http://127.0.0.1:' + PORT };
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const rawBody = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode, headers: res.headers,
                        body: rawBody.toString('utf8'), rawBody,
                    });
                });
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
const cookieOf = r => (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
function assertJsonOk(r) {
    assert.strictEqual(r.status, 200, r.body);
    const data = JSON.parse(r.body);
    assert.strictEqual(data.ok, true, r.body);
    return data;
}
function assertJsonFail(r) {
    assert.strictEqual(r.status, 200, r.body);
    const data = JSON.parse(r.body);
    assert.strictEqual(data.ok, false, r.body);
    return data;
}
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
(async () => {
    await waitForServer(PORT);
    const storage = require('../../lib/storage');
    const messageView = require('../../lib/message-view');
    const viewContent = m => m && m.forwarded_from
        ? messageView.forwardContent(m.forwarded_from)
        : String((m && m.content) || '');
    const A = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchA', password: 'pw123456', confirm_password: 'pw123456' } }));
    const B = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchB', password: 'pw123456', confirm_password: 'pw123456' } }));
    const C = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchC', password: 'pw123456', confirm_password: 'pw123456' } }));
    const uidA = storage.findUserByNickname('batchA').id;
    const uidB = storage.findUserByNickname('batchB').id;
    const uidC = storage.findUserByNickname('batchC').id;
    await check('私信断线恢复：状态接口返回未读', async () => {
        storage.appendDM(uidA, uidB, 'offline-state');
        const data = assertJsonOk(
            await req('GET', '/messages/state', { cookie: B }));
        assert.ok(data.total >= 1);
        const conv = data.conversations.find(c => c.other === uidA);
        assert.ok(conv && conv.unread >= 1, '缺少会话未读数');
        storage.markDMRead(uidB, uidA);
    });
    const f1 = storage.addUserFile(uidA, { filename: 'alpha.txt', mime: 'text/plain', buffer: Buffer.from('a') });
    const f2 = storage.addUserFile(uidA, { filename: 'beta.txt', mime: 'text/plain', buffer: Buffer.from('b') });
    await check('文件：批量置顶并排序到最前', async () => {
        const r = await req('POST', '/myfile/batch',
            { cookie: A, body: { ids: f1.id + ',' + f2.id, action: 'pin' } });
        assertJsonOk(r);
        const list = storage.listUserFiles(uidA);
        assert.strictEqual(list[0].pinned, true);
        assert.strictEqual(list[1].pinned, true);
    });
    await check('文件：批量查找替换重命名', async () => {
        const r = await req('POST', '/myfile/batch', {
            cookie: A,
            body: {
                ids: f1.id + ',' + f2.id, action: 'rename',
                mode: 'replace', find: 'a', replace: 'z',
            },
        });
        assertJsonOk(r);
        assert.strictEqual(storage.getUserFile(uidA, f1.id).filename, 'zlphz.txt');
        assert.strictEqual(storage.getUserFile(uidA, f2.id).filename, 'betz.txt');
    });
    await check('文件：批量可见性', async () => {
        const r = await req('POST', '/myfile/batch', {
            cookie: A,
            body: { ids: f1.id + ',' + f2.id, action: 'visibility', visibility: 'public' },
        });
        assertJsonOk(r);
        assert.strictEqual(storage.getUserFile(uidA, f1.id).visibility, 'public');
        assert.strictEqual(storage.getUserFile(uidA, f2.id).visibility, 'public');
    });
    await check('文件：批量下载为 ZIP', async () => {
        const r = await req('POST', '/myfile/batch/download', {
            cookie: A, body: { ids: f1.id + ',' + f2.id },
        });
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'] || '', /^application\/zip/);
        assert.match(r.headers['content-disposition'] || '', /^attachment;/);
        assert.strictEqual(r.rawBody.readUInt32LE(0), 0x04034B50);
        assert.ok(r.rawBody.includes(Buffer.from('zlphz.txt')));
        assert.ok(r.rawBody.includes(Buffer.from('betz.txt')));
    });
    await check('文件：批量删除任一无效则整体不执行', async () => {
        const d1 = storage.addUserFile(uidA, {
            filename: 'del-a.txt', mime: 'text/plain', buffer: Buffer.from('a'),
        });
        const d2 = storage.addUserFile(uidA, {
            filename: 'del-b.txt', mime: 'text/plain', buffer: Buffer.from('b'),
        });
        let r = await req('POST', '/myfile/batch', {
            cookie: A, body: { ids: d1.id + ',missing-file', action: 'delete' },
        });
        assertJsonFail(r);
        assert.ok(storage.getUserFile(uidA, d1.id), '无效选择时不应删除');
        r = await req('POST', '/myfile/batch', {
            cookie: A, body: { ids: d1.id + ',' + d2.id, action: 'delete' },
        });
        assertJsonOk(r);
        assert.strictEqual(storage.getUserFile(uidA, d1.id), null);
        assert.strictEqual(storage.getUserFile(uidA, d2.id), null);
    });
    await check('文件：批量操作任一无效则整体不执行', async () => {
        const before = storage.getUserFile(uidA, f1.id).filename;
        const r = await req('POST', '/myfile/batch', {
            cookie: A,
            body: {
                ids: f1.id + ',missing-file', action: 'rename',
                mode: 'prefix', value: 'x-',
            },
        });
        assertJsonFail(r);
        assert.strictEqual(storage.getUserFile(uidA, f1.id).filename, before);
    });
    const df1 = storage.addDomainFile('system', {
        filename: 'report-a.pdf', mime: 'application/pdf', buffer: Buffer.from('a'), uploader: uidA,
    });
    const df2 = storage.addDomainFile('system', {
        filename: 'report-b.pdf', mime: 'application/pdf', buffer: Buffer.from('b'), uploader: uidA,
    });
    await check('域文件：批量置顶与重命名', async () => {
        let r = await req('POST', '/domain/system/files/batch', {
            cookie: A,
            body: { ids: df1.id + ',' + df2.id, action: 'pin' },
        });
        assertJsonOk(r);
        assert.strictEqual(storage.getDomainFile('system', df1.id).pinned, true);
        r = await req('POST', '/domain/system/files/batch', {
            cookie: A,
            body: {
                ids: df1.id + ',' + df2.id, action: 'rename',
                mode: 'prefix', value: 'new-',
            },
        });
        assertJsonOk(r);
        assert.strictEqual(storage.getDomainFile('system', df1.id).filename, 'new-report-a.pdf');
    });
    await check('PDF 内联响应可被同源 iframe 预览', async () => {
        const r = await req('GET', '/domain/system/files/' + df1.id, { cookie: A });
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'] || '', /^application\/pdf/);
        assert.match(r.headers['content-disposition'] || '', /^inline/);
        assert.ok(!/sandbox/.test(r.headers['content-security-policy'] || ''));
    });
    await check('域文件：批量下载为 ZIP', async () => {
        const r = await req('POST', '/domain/system/files/batch/download', {
            cookie: A, body: { ids: df1.id + ',' + df2.id },
        });
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'] || '', /^application\/zip/);
        assert.strictEqual(r.rawBody.readUInt32LE(0), 0x04034B50);
        assert.ok(r.rawBody.includes(Buffer.from('new-report-a.pdf')));
        assert.ok(r.rawBody.includes(Buffer.from('report-b.pdf')));
    });
    await check('域文件：批量删除', async () => {
        const d1 = storage.addDomainFile('system', {
            filename: 'del-a.txt', mime: 'text/plain', buffer: Buffer.from('a'), uploader: uidA,
        });
        const d2 = storage.addDomainFile('system', {
            filename: 'del-b.txt', mime: 'text/plain', buffer: Buffer.from('b'), uploader: uidA,
        });
        const r = await req('POST', '/domain/system/files/batch', {
            cookie: A, body: { ids: d1.id + ',' + d2.id, action: 'delete' },
        });
        assertJsonOk(r);
        assert.strictEqual(storage.getDomainFile('system', d1.id), null);
        assert.strictEqual(storage.getDomainFile('system', d2.id), null);
    });
    storage.saveDiscussion('system', 'batch-disc', {
        name: 'batch-disc', title: 'Hello World', created_at: storage.nowIso(),
    });
    await check('讨论：批量置顶', async () => {
        const r = await req('POST', '/domain/system/manage/discussions',
            { cookie: A, body: { ids: 'batch-disc', action: 'batch-pin' } });
        assertJsonOk(r);
        assert.strictEqual(storage.loadDiscussion('system', 'batch-disc').pinned, true);
    });
    await check('讨论：批量改标题且不改 ID', async () => {
        const r = await req('POST', '/domain/system/manage/discussions', {
            cookie: A,
            body: {
                ids: 'batch-disc', action: 'batch-title',
                mode: 'replace', find: 'Hello', replace: 'Hi',
            },
        });
        assertJsonOk(r);
        const cfg = storage.loadDiscussion('system', 'batch-disc');
        assert.strictEqual(cfg.title, 'Hi World');
        assert.strictEqual(cfg.name, 'batch-disc');
    });
    storage.saveDiscussion('system', 'batch-del-a', {
        name: 'batch-del-a', title: 'A', created_at: storage.nowIso(),
    });
    storage.saveDiscussion('system', 'batch-del-b', {
        name: 'batch-del-b', title: 'B', created_at: storage.nowIso(),
    });
    await check('讨论：批量删除任一无效则整体不执行', async () => {
        const r = await req('POST', '/domain/system/manage/discussions', {
            cookie: A, body: { ids: 'batch-del-a,general', action: 'batch-delete' },
        });
        assertJsonFail(r);
        assert.ok(storage.loadDiscussion('system', 'batch-del-a').name);
        assert.ok(storage.loadDiscussion('system', 'general').name);
    });
    await check('讨论：批量删除', async () => {
        const r = await req('POST', '/domain/system/manage/discussions', {
            cookie: A, body: { ids: 'batch-del-a,batch-del-b', action: 'batch-delete' },
        });
        assertJsonOk(r);
        assert.ok(!storage.loadDiscussion('system', 'batch-del-a').name);
        assert.ok(!storage.loadDiscussion('system', 'batch-del-b').name);
    });
    const wsA = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: A, Origin: `http://127.0.0.1:${PORT}` } }));
    const wsB = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: B, Origin: `http://127.0.0.1:${PORT}` } }));
    const ids = [];
    for (const content of ['batch one', 'batch two']) {
        const p = waitFor(wsB, d => d.type === 'new_message' && d.message.content === content);
        wsA.send(JSON.stringify({ type: 'message', content }));
        const d = await p;
        ids.push(d.message.id);
    }
    await check('消息：批量置顶', async () => {
        const p = waitFor(wsA, d => d.type === 'batch_result' && d.op === 'pin');
        wsA.send(JSON.stringify({ type: 'batch_pin', message_ids: ids, pinned: true }));
        await p;
        for (const id of ids) {
            assert.strictEqual(storage.findMessage('system', 'general', id).pinned, true);
        }
    });
    await check('消息：编辑后保留历史版本', async () => {
        for (const content of ['edited one', 'edited two']) {
            const p = waitFor(wsB, d => d.type === 'message_edited'
                && d.message_id === ids[0] && d.content === content);
            wsA.send(JSON.stringify({
                type: 'edit', message_id: ids[0], content,
            }));
            await p;
        }
        const r = await req('GET',
            '/domain/system/discuss/general/messages/' + ids[0] + '/history',
            { cookie: A });
        assertJsonOk(r);
        const versions = JSON.parse(r.body).versions.map(v => v.content);
        assert.deepStrictEqual(versions,
            ['batch one', 'edited one', 'edited two']);
    });
    await check('消息：单条删除会清掉置顶标记', async () => {
        const pNew = waitFor(wsB, d => d.type === 'new_message'
            && d.message.content === 'single pinned delete');
        wsA.send(JSON.stringify({ type: 'message', content: 'single pinned delete' }));
        const id = (await pNew).message.id;
        const pPin = waitFor(wsA, d => d.type === 'message_pinned'
            && d.message_id === id && d.pinned === true);
        wsA.send(JSON.stringify({ type: 'pin', message_id: id }));
        await pPin;
        const pDel = waitFor(wsB, d => d.type === 'message_deleted'
            && d.message_id === id);
        wsA.send(JSON.stringify({ type: 'delete', message_id: id }));
        await pDel;
        const m = storage.findMessage('system', 'general', id);
        assert.strictEqual(m.deleted, true);
        assert.strictEqual(m.pinned, false);
    });
    await check('消息：批量删除会清掉置顶标记', async () => {
        const p = waitFor(wsA, d => d.type === 'batch_result' && d.op === 'delete');
        wsA.send(JSON.stringify({ type: 'batch_delete', message_ids: ids }));
        await p;
        for (const id of ids) {
            const m = storage.findMessage('system', 'general', id);
            assert.strictEqual(m.deleted, true);
            assert.strictEqual(m.pinned, false);
        }
    });
    await check('消息：批量删除任一无效则整体不执行', async () => {
        const m = { id: 'batch-keep', user_id: uidA, nickname: 'batchA', content: 'keep', created_at: storage.nowIso() };
        storage.appendMessage('system', 'general', m);
        const p = waitFor(wsA, d => d.type === 'error');
        wsA.send(JSON.stringify({ type: 'batch_delete', message_ids: ['batch-keep', 'missing-id'] }));
        await p;
        assert.ok(!storage.findMessage('system', 'general', 'batch-keep').deleted);
    });
    wsA.close(); wsB.close();
    await check('转发：讨论消息到其他讨论', async () => {
        storage.saveDiscussion('system', 'fwd', {
            name: 'fwd', title: '转发目标', created_at: storage.nowIso(),
        });
        const src = {
            id: 'fwd-src', user_id: uidA, nickname: 'batchA',
            content: '**原消息**', created_at: storage.nowIso(),
        };
        storage.appendMessage('system', 'general', src);
        const r = await req('POST', '/forward', {
            cookie: A,
            body: {
                message_id: src.id, source_type: 'discuss',
                source_domain: 'system', source_disc: 'general',
                target_domain: 'system', target_disc: 'fwd',
            },
        });
        assertJsonOk(r);
        const list = storage.loadMessagePage('system', 'fwd', { limit: 100 }).messages;
        const got = list.find(m => m.forwarded_from && m.forwarded_from.id === src.id);
        assert.ok(got, '目标讨论缺少转发消息');
        assert.strictEqual(got.content, '', '转发消息不应复制正文');
        assert.ok(viewContent(got).includes('**原消息**'));
        assert.ok(viewContent(got).includes('转发自'));
        assert.strictEqual(got.forwarded_from.id, src.id);
        const ws = await openRetry(() => new WebSocket(
            `ws://127.0.0.1:${PORT}/ws/discuss/system/fwd`,
            { headers: { Cookie: A, Origin: `http://127.0.0.1:${PORT}` } }));
        const p = waitFor(ws, d => d.type === 'new_message'
            && d.message.content === 'reply-forward');
        ws.send(JSON.stringify({
            type: 'message', content: 'reply-forward', reply_to: got.id,
        }));
        const reply = await p;
        const pinP = waitFor(ws, d => d.type === 'message_pinned'
            && d.message_id === got.id && d.pinned === true);
        ws.send(JSON.stringify({ type: 'pin', message_id: got.id }));
        const pin = await pinP;
        ws.close();
        assert.ok(reply.message.reply_info
            && reply.message.reply_info.content.includes('原消息'),
            '实时回复转发消息时未显示转发正文');
        assert.ok(pin.message && pin.message.content.includes('原消息'),
            '实时置顶转发消息时未显示转发正文');
        const { buildDiscussData } = require('../../lib/routes/discuss');
        const page = buildDiscussData('system', 'fwd', storage.loadUser(uidA));
        const pinned = page.pinned_messages.find(p => p.id === got.id);
        assert.ok(pinned && pinned.content.includes('原消息'),
            '刷新后置顶转发消息缺少转发正文');
    });
    await check('转发：锁定转发时的消息版本', async () => {
        const src = {
            id: 'fwd-lock-src', user_id: uidA, nickname: 'batchA',
            content: '锁定原文', created_at: '2020-01-01T00:00:00.000Z',
        };
        storage.appendMessage('system', 'general', src);
        const r = await req('POST', '/forward', {
            cookie: A,
            body: {
                message_id: src.id, source_type: 'discuss',
                source_domain: 'system', source_disc: 'general',
                target_domain: 'system', target_disc: 'fwd',
            },
        });
        assertJsonOk(r);
        const list = storage.loadMessagePage('system', 'fwd', { limit: 100 }).messages;
        const got = list.find(m => m.forwarded_from
            && m.forwarded_from.id === src.id);
        assert.ok(got, '缺少锁定版本的转发消息');
        assert.ok(got.forwarded_from.locked_at, '转发未记录锁定时间');
        assert.strictEqual(got.forwarded_from.items[0].content, '锁定原文');
        storage.updateMessage('system', 'general', src.id, {
            content: '后来修改', edited_at: storage.nowIso(),
        });
        const locked = storage.findMessage('system', 'fwd', got.id);
        assert.ok(viewContent(locked).includes('锁定原文'), '转发内容未锁定');
        assert.ok(!viewContent(locked).includes('后来修改'), '转发内容跟随了原消息');
    });
    await check('转发：转发消息不可编辑', async () => {
        const fwd = storage.loadMessagePage('system', 'fwd', { limit: 100 }).messages
            .find(m => m.forwarded_from);
        assert.ok(fwd, '缺少转发消息');
        const ws = await openRetry(() => new WebSocket(
            `ws://127.0.0.1:${PORT}/ws/discuss/system/fwd`,
            { headers: { Cookie: A, Origin: `http://127.0.0.1:${PORT}` } }));
        const p = waitFor(ws, d => d.type === 'error'
            && String(d.msg || '').includes('不能编辑'));
        ws.send(JSON.stringify({
            type: 'edit', message_id: fwd.id, content: 'should fail',
        }));
        await p;
        ws.close();
    });
    await check('转发：合并与分条转发多选消息', async () => {
        const src2 = {
            id: 'fwd-src-2', user_id: uidA, nickname: 'batchA',
            content: '第二条原消息', created_at: storage.nowIso(),
        };
        storage.appendMessage('system', 'general', src2);
        const base = {
            message_ids: 'fwd-src,' + src2.id,
            source_type: 'discuss',
            source_domain: 'system', source_disc: 'general',
            target_domain: 'system', target_disc: 'fwd',
        };
        const before = storage.getMessageStats('system', 'fwd').total;
        let r = await req('POST', '/forward', {
            cookie: A, body: Object.assign({}, base, { forward_mode: 'merge' }),
        });
        assertJsonOk(r);
        assert.strictEqual(JSON.parse(r.body).count, 1);
        const merged = storage.loadMessagePage('system', 'fwd', { limit: 100 }).messages
            .find(m => viewContent(m).includes('第二条原消息'));
        assert.ok(merged && viewContent(merged).includes('**原消息**'), '合并转发缺少消息内容');
        r = await req('POST', '/forward', {
            cookie: A, body: Object.assign({}, base, { forward_mode: 'split' }),
        });
        assertJsonOk(r);
        assert.strictEqual(JSON.parse(r.body).count, 2);
        assert.strictEqual(storage.getMessageStats('system', 'fwd').total, before + 3);
    });
    await check('转发：分条转发保持原消息顺序', async () => {
        storage.saveDiscussion('system', 'fwd-order', {
            name: 'fwd-order', title: '顺序', created_at: storage.nowIso(),
        });
        storage.appendMessage('system', 'general', {
            id: 'fwd-order-a', user_id: uidA, nickname: 'batchA',
            content: '顺序 A', created_at: '2020-01-01T00:00:00.000Z',
        });
        storage.appendMessage('system', 'general', {
            id: 'fwd-order-b', user_id: uidA, nickname: 'batchA',
            content: '顺序 B', created_at: '2020-01-01T00:00:01.000Z',
        });
        const r = await req('POST', '/forward', {
            cookie: A,
            body: {
                message_ids: 'fwd-order-b,fwd-order-a',
                source_type: 'discuss', forward_mode: 'split',
                source_domain: 'system', source_disc: 'general',
                target_domain: 'system', target_disc: 'fwd-order',
            },
        });
        assertJsonOk(r);
        const list = storage.loadMessagePage('system', 'fwd-order', { limit: 100 }).messages;
        const ia = list.findIndex(m => m.forwarded_from
            && m.forwarded_from.id === 'fwd-order-a');
        const ib = list.findIndex(m => m.forwarded_from
            && m.forwarded_from.id === 'fwd-order-b');
        assert.ok(ia >= 0 && ib >= 0, '分条转发缺少消息');
        assert.ok(ia < ib, '分条转发顺序错误');
    });
    await check('转发：私信消息到讨论，且非会话成员不可转发', async () => {
        const dm = storage.appendDM(uidA, uidB, '私信原文');
        let r = await req('POST', '/forward', {
            cookie: A,
            body: {
                message_id: dm.id, source_type: 'dm', source_peer: uidB,
                target_domain: 'system', target_disc: 'fwd',
            },
        });
        assertJsonOk(r);
        assert.ok(storage.loadMessagePage('system', 'fwd', { limit: 100 }).messages
            .some(m => viewContent(m).includes('私信原文')));
        r = await req('POST', '/forward', {
            cookie: C,
            body: {
                message_id: dm.id, source_type: 'dm', source_peer: uidB,
                target_domain: 'system', target_disc: 'fwd',
            },
        });
        assert.strictEqual(JSON.parse(r.body).ok, false);
    });
    await check('转发：目标列表包含用户与讨论', async () => {
        const r = await req('GET', '/forward/targets', { cookie: A });
        const data = assertJsonOk(r);
        assert.ok(data.users.some(u => u.id === uidB), '目标列表缺少用户');
        assert.ok(data.targets.some(g => g.domain === 'system'), '目标列表缺少讨论');
    });
    await check('转发：讨论消息到用户私信', async () => {
        const src = storage.findMessage('system', 'general', 'fwd-src');
        const before = storage.loadAllDM(uidA, uidB).length;
        const r = await req('POST', '/forward', {
            cookie: A,
            body: {
                message_id: src.id, source_type: 'discuss',
                source_domain: 'system', source_disc: 'general',
                target_user: uidB,
            },
        });
        assertJsonOk(r);
        const all = storage.loadAllDM(uidA, uidB);
        assert.strictEqual(all.length, before + 1);
        const got = all[all.length - 1];
        assert.ok(got.forwarded_from, '私信转发缺少引用');
        assert.strictEqual(got.content, '');
        assert.ok(viewContent(got).includes('**原消息**'));
    });
    await check('转发：非法目标/来源返回失败而不是 500', async () => {
        const base = {
            message_id: 'fwd-src', source_type: 'discuss',
            source_domain: 'system', source_disc: 'general',
            target_domain: 'system', target_disc: 'fwd',
        };
        let r = await req('POST', '/forward', {
            cookie: A, body: Object.assign({}, base, { target_disc: '../bad' }),
        });
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false);
        r = await req('POST', '/forward', {
            cookie: A, body: Object.assign({}, base, { source_disc: '../bad' }),
        });
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false);
        r = await req('POST', '/forward', {
            cookie: A, body: Object.assign({}, base, {
                source_type: 'dm', source_peer: '../bad',
            }),
        });
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false);
        r = await req('POST', '/forward', {
            cookie: A, body: Object.assign({}, base, { source_type: 'bad' }),
        });
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false);
    });
    await check('管理：创建测试域', async () => {
        const r = await req('POST', '/create/domain', {
            cookie: A, body: { name: 'batchdom', display_name: 'Batch Domain' },
        });
        assertJsonOk(r);
        assert.ok(storage.domainExists('batchdom'));
    });
    let dom = storage.loadDomain('batchdom');
    dom.join_applications = [
        { uid: uidB, nickname: 'batchB', message: 'b', created_at: storage.nowIso() },
        { uid: uidC, nickname: 'batchC', message: 'c', created_at: storage.nowIso() },
    ];
    storage.saveDomain('batchdom', dom);
    await check('域申请：批量通过与拒绝', async () => {
        let r = await req('POST', '/domain/batchdom/manage/applications',
            { cookie: A, body: { ids: uidB, action: 'approve' } });
        assertJsonOk(r);
        dom = storage.loadDomain('batchdom');
        assert.ok(dom.members[uidB], '通过后未加入成员');
        assert.ok(dom.join_applications.some(a => a.uid === uidC), '未选中的申请被误删');
        r = await req('POST', '/domain/batchdom/manage/applications',
            { cookie: A, body: { ids: uidC, action: 'reject' } });
        assertJsonOk(r);
        dom = storage.loadDomain('batchdom');
        assert.ok(!dom.members[uidC]);
        assert.ok(!dom.join_applications.some(a => a.uid === uidC));
    });
    dom = storage.loadDomain('batchdom');
    dom.join_applications = [
        { uid: uidB, nickname: 'batchB', message: 'again', created_at: storage.nowIso() },
    ];
    storage.saveDomain('batchdom', dom);
    await check('全局申请：批量通过', async () => {
        const r = await req('POST', '/manage/join_applications', {
            cookie: A,
            body: { application_ids: 'batchdom:' + uidB, action: 'approve' },
        });
        assertJsonOk(r);
        dom = storage.loadDomain('batchdom');
        assert.ok(dom.members[uidB]);
        assert.strictEqual(dom.join_applications.length, 0);
    });
    await check('管理用户：批量封禁/解封，且拒绝自己', async () => {
        let r = await req('POST', '/manage/users/batch',
            { cookie: A, body: { ids: uidB, action: 'ban', reason: 'test' } });
        assertJsonOk(r);
        assert.strictEqual(storage.loadUser(uidB).banned, true);
        r = await req('POST', '/manage/users/batch',
            { cookie: A, body: { ids: uidB, action: 'unban' } });
        assertJsonOk(r);
        assert.ok(!storage.loadUser(uidB).banned);
        r = await req('POST', '/manage/users/batch',
            { cookie: A, body: { ids: uidA, action: 'ban', reason: 'self' } });
        const data = assertJsonFail(r);
        assert.ok(data.error.includes('自己'), data.error);
        assert.ok(!storage.loadUser(uidA).banned);
    });
    dom = storage.loadDomain('batchdom');
    dom.join_applications = [
        { uid: uidC, nickname: 'batchC', message: 'render', created_at: storage.nowIso() },
    ];
    storage.saveDomain('batchdom', dom);
    await check('批量：相关页面可渲染', async () => {
        const pages = [
            ['/myfile', A, 'data-batch-form'],
            ['/domain/system/files', A, 'data-batch-form'],
            ['/domain/system/manage/discussions', A, 'data-batch-form'],
            ['/domain/system/discuss/general', A, 'messageBatchBar'],
            ['/manage/users', A, 'data-batch-form'],
            ['/manage/join_applications', A, 'data-batch-form'],
            ['/domain/batchdom/manage/applications', A, 'data-batch-form'],
            ['/help', A, 'id="batch"'],
        ];
        for (const [p, cookie, marker] of pages) {
            const r = await req('GET', p, { cookie });
            assert.strictEqual(r.status, 200, p + ' 返回 ' + r.status);
            assert.ok(r.body.includes(marker), p + ' 缺少 ' + marker);
        }
    });
    await check('批量测试：服务端无异常', () => {
        assert.strictEqual(srvErr.length, 0, srvErr.join(''));
    });
    proc.kill();
    for (const row of results) console.log(row[0] + '  ' + row[1]);
    const failed = results.filter(r => r[0] === 'FAIL').length;
    console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
})().catch(e => {
    console.error(e);
    proc.kill();
    process.exitCode = 1;
});

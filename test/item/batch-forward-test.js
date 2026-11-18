'use strict';
const {
    assert, http, path, WebSocket, sleep, ROOT, PORT, check, req, cookieOf,
    assertJsonOk, assertJsonFail, openRetry, waitFor, startServer,
    setupUsers, finish, fatal,
} = require('./_batch-common');
const setup = async () => {
    await startServer();
    return setupUsers();
};
(async () => {
    const { storage, messageView, viewContent, A, B, C, uidA, uidB, uidC } = await setup();
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
    await finish('批量转发');
})().catch(fatal);

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
    await finish('批量消息');
})().catch(fatal);

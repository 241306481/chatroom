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
    await finish('批量文件与讨论');
})().catch(fatal);

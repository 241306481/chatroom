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
    await finish('批量管理');
})().catch(fatal);

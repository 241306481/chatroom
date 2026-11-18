'use strict';
const {
    assert, fs, path, http, WebSocket, sleep, ROOT, PORT, BASE, WS_URL,
    PRIV, PERM, SYSTEM_ROLES_BUILTIN, checkDual, check, storage, auth,
    sysRoles, rootId, opsId, viewerId, adminId, dmodId, mentionIds,
    privateFile, publicFile, htmlFile, textFile, request, get, post,
    cookieOf, tryOpen, waitClose, startServer, loginUsers, finish, fatal,
} = require('./_stage3-common');
(async () => {
    await startServer();
    const { rootC, opsC, viewerC, dmodC } = await loginUsers();
    await check('审批已存在成员的申请不会重置角色/经验', async () => {
        const initial = storage.loadDomain('opend');
        const before = Object.assign({}, initial.members[dmodId], {
            level: 7, exp: 123,
        });
        initial.members[dmodId] = before;
        storage.saveDomain('opend', initial);
        const addApp = () => {
            const d = storage.loadDomain('opend');
            d.join_applications = Array.isArray(d.join_applications) ? d.join_applications : [];
            d.join_applications.push({
                uid: dmodId, nickname: 'dmodx', message: 'x',
                created_at: storage.nowIso(),
            });
            storage.saveDomain('opend', d);
        };
        addApp();
        const single = await post('/domain/opend/manage/applications',
            { uid: dmodId, action: 'approve' }, rootC);
        assert.strictEqual(single.status, 200, single.body);
        assert.strictEqual(JSON.parse(single.body).ok, true, single.body);
        let member = storage.loadDomain('opend').members[dmodId];
        assert.strictEqual(member.role, 'dmod');
        assert.strictEqual(member.level, 7);
        assert.strictEqual(member.exp, 123);
        assert.strictEqual(member.joined_at, before.joined_at);
        addApp();
        const batch = await post('/domain/opend/manage/applications',
            { ids: dmodId, action: 'approve' }, rootC);
        assert.strictEqual(batch.status, 200, batch.body);
        assert.strictEqual(JSON.parse(batch.body).ok, true, batch.body);
        member = storage.loadDomain('opend').members[dmodId];
        assert.strictEqual(member.role, 'dmod');
        assert.strictEqual(member.level, 7);
        assert.strictEqual(member.exp, 123);
        assert.strictEqual(member.joined_at, before.joined_at);
        addApp();
        const globalBatch = await post('/manage/join_applications',
            { application_ids: 'opend:' + dmodId, action: 'approve' }, rootC);
        assert.strictEqual(globalBatch.status, 200, globalBatch.body);
        assert.strictEqual(JSON.parse(globalBatch.body).ok, true, globalBatch.body);
        member = storage.loadDomain('opend').members[dmodId];
        assert.strictEqual(member.role, 'dmod');
        assert.strictEqual(member.level, 7);
        assert.strictEqual(member.exp, 123);
        assert.strictEqual(member.joined_at, before.joined_at);
        addApp();
        const globalSingle = await post('/manage/join_applications',
            { domain_name: 'opend', uid: dmodId, action: 'approve' }, rootC);
        assert.strictEqual(globalSingle.status, 200, globalSingle.body);
        assert.strictEqual(JSON.parse(globalSingle.body).ok, true, globalSingle.body);
        member = storage.loadDomain('opend').members[dmodId];
        assert.strictEqual(member.role, 'dmod');
        assert.strictEqual(member.level, 7);
        assert.strictEqual(member.exp, 123);
        assert.strictEqual(member.joined_at, before.joined_at);
    });
    await check('在线会话页可强制下线且保护高级管理员', async () => {
        const page = await get('/manage/sessions', opsC);
        assert.strictEqual(page.status, 200, '会话页 status=' + page.status);
        assert.ok(page.body.includes('在线会话'), '会话页内容缺失');
        assert.ok(page.body.includes('viewx'), '会话列表缺少测试用户');
        const denied = await get('/manage/sessions', viewerC);
        assert.strictEqual(denied.status, 403, '普通用户不应访问');
        const menu = await get('/manage', opsC);
        assert.ok(menu.body.includes('/manage/sessions'), '管理菜单缺少会话入口');
        const rootRevoke = await post('/manage/sessions',
            { action: 'revoke_user', uid: rootId }, opsC);
        assert.ok(rootRevoke.body.includes('不能强制超级管理员下线'),
            '未保护超级管理员会话');
        const alive = await get('/manage', rootC);
        assert.strictEqual(alive.status, 200, '超级管理员被误下线');
        const revoke = await post('/manage/sessions',
            { action: 'revoke_user', uid: viewerId }, opsC);
        assert.ok(revoke.body.includes('已强制下线'), '未执行强制下线');
        const after = await get('/manage/audit', viewerC);
        assert.ok(after.status >= 300 && after.status < 400,
            '被下线会话仍可用, status=' + after.status);
        assert.ok(String(after.headers.location || '').startsWith('/login'),
            '被下线会话未跳转登录页');
    });
    await check('WebSocket 拒绝缺失或跨站 Origin，但允许同源', async () => {
        const wsUrl = 'ws://127.0.0.1:' + PORT + '/ws/discuss/system/general';
        const missing = new WebSocket(wsUrl, {
            headers: { Cookie: rootC },
        });
        assert.strictEqual(await tryOpen(missing), false, '缺失 Origin 竟然建立成功');
        const bad = new WebSocket(wsUrl, {
            headers: { Cookie: rootC, Origin: 'http://evil.example' },
        });
        assert.strictEqual(await tryOpen(bad), false, '跨站 Origin 竟然建立成功');
        const good = new WebSocket(wsUrl, {
            headers: { Cookie: rootC, Origin: BASE },
        });
        assert.strictEqual(await tryOpen(good), true, '同源 Origin 被拒绝');
        good.close();
    });
    await check('退出登录会关闭该会话的 WebSocket', async () => {
        const ws = new WebSocket(WS_URL, {
            headers: { Cookie: rootC, Origin: BASE },
        });
        assert.strictEqual(await tryOpen(ws), true, 'WebSocket 未建立');
        const closed = waitClose(ws);
        const r = await post('/logout', {}, rootC);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, true, r.body);
        const cleared = (r.headers['set-cookie'] || [])
            .find(c => /^token=;/.test(c)) || '';
        assert.ok(/HttpOnly/.test(cleared), '清理 Cookie 缺少 HttpOnly');
        assert.ok(/SameSite=Lax/.test(cleared), '清理 Cookie 缺少 SameSite');
        assert.ok(!/Secure/.test(cleared), 'HTTP 清理 Cookie 不应带 Secure');
        assert.strictEqual(await closed, true, '退出登录后 WebSocket 未关闭');
    });
    await check('活动会话数量有硬上限，不会无限增长', () => {
        const sessions = require('../../lib/auth/sessions');
        for (let i = 0; i < sessions.MAX_SESSIONS + 3; i++) {
            sessions.createSession('u-cap', { ua: 'UA/Cap', ip: '10.10.0.1' });
        }
        try {
            assert.ok(sessions.listSessions().length <= sessions.MAX_SESSIONS,
                '会话数超过硬上限');
        } finally {
            sessions.destroyAllUserSessions('u-cap');
        }
    });
    await finish('阶段3：会话与 WebSocket');
})().catch(fatal);

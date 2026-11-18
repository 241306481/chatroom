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
    await check('私有文件仅所有者可读，公开文件可读', async () => {
        const denied = await get(`/myfile/${rootId}/${privateFile.id}`, viewerC);
        assert.strictEqual(denied.status, 403, '私有文件 metadata status=' + denied.status);
        const deniedDown = await get(`/myfile/${rootId}/${privateFile.id}/download`, viewerC);
        assert.strictEqual(deniedDown.status, 403, '私有文件下载 status=' + deniedDown.status);
        const allowed = await get(`/myfile/${rootId}/${publicFile.id}`, viewerC);
        assert.strictEqual(allowed.status, 200, '公开文件 status=' + allowed.status);
        assert.ok(allowed.body.includes('public-content'), '公开文件内容错误');
        const anon = await get(`/myfile/${rootId}/${publicFile.id}`);
        assert.strictEqual(anon.status, 302, '未登录不应读取文件, status=' + anon.status);
    });
    await check('危险 MIME 强制下载，文本内联也带沙箱', async () => {
        const html = await get(`/myfile/${rootId}/${htmlFile.id}`, viewerC);
        assert.strictEqual(html.status, 200);
        assert.ok(/^attachment/.test(html.headers['content-disposition'] || ''),
            'HTML 不应内联');
        assert.ok(String(html.headers['content-security-policy'] || '').includes('sandbox'),
            'HTML 缺少沙箱 CSP');
        assert.strictEqual(html.headers['x-content-type-options'], 'nosniff');
        const text = await get(`/myfile/${rootId}/${textFile.id}`, viewerC);
        assert.strictEqual(text.status, 200);
        assert.ok(/^inline/.test(text.headers['content-disposition'] || ''),
            'text/plain 应内联');
        assert.ok(String(text.headers['content-security-policy'] || '').includes('sandbox'),
            'text/plain 缺少沙箱 CSP');
    });
    await check('CSRF：缺少或跨站 Origin 的写请求被拒绝', async () => {
        const creds = { nickname: 'rootx', password: 'pw123456' };
        const missing = await request('POST', '/login', { body: creds, origin: false });
        assert.strictEqual(missing.status, 403, 'missing status=' + missing.status);
        const foreign = await request('POST', '/login',
            { body: creds, origin: 'http://evil.example' });
        assert.strictEqual(foreign.status, 403, 'foreign status=' + foreign.status);
        const wrongProto = await request('POST', '/login',
            { body: creds, origin: 'https://127.0.0.1:' + PORT });
        assert.strictEqual(wrongProto.status, 403,
            '跨协议 Origin 应被拒绝, status=' + wrongProto.status);
        const crossSite = await request('POST', '/login',
            { body: creds, headers: { 'Sec-Fetch-Site': 'cross-site' } });
        assert.strictEqual(crossSite.status, 403,
            'Sec-Fetch-Site: cross-site 应被拒绝, status=' + crossSite.status);
    });
    await check('未知管理操作统一报错，不静默成功', async () => {
        const ban = await post('/manage/users/ban',
            { action: 'bogus', user_id: viewerId }, rootC);
        assert.strictEqual(ban.status, 200, ban.body);
        const banData = JSON.parse(ban.body);
        assert.strictEqual(banData.ok, false, ban.body);
        assert.ok(banData.error, '未知操作未报错');
        const sysRole = await post('/manage/system_roles', { action: 'bogus' }, rootC);
        assert.ok(sysRole.body.includes('未知操作'));
        const ipBan = await post('/manage/ip_bans', { action: 'bogus' }, rootC);
        assert.ok(ipBan.body.includes('未知操作'));
        const rate = await post('/manage/rate_limits', { action: 'bogus' }, rootC);
        assert.ok(rate.body.includes('未知操作'));
        const domRole = await post('/domain/opend/manage/role', { action: 'bogus' }, rootC);
        assert.ok(domRole.body.includes('未知操作'));
    });
    await check('角色显示名超长会截断且拒绝原型键名', async () => {
        const sys = await post('/manage/system_roles', {
            action: 'create', role_name: 'longsys', display: 'S'.repeat(150),
        }, rootC);
        assert.strictEqual(sys.status, 200, sys.body);
        sysRoles.invalidateCache();
        const savedSys = sysRoles.loadRoles().longsys;
        assert.ok(savedSys, '系统角色未创建');
        assert.strictEqual(savedSys.display.length, 100, '系统角色显示名未截断');
        assert.strictEqual(sysRoles.roleExists('__proto__'), false);
        assert.strictEqual(sysRoles.roleExists('toString'), false);
        const badSys = await post('/manage/system_roles', {
            action: 'create', role_name: 'constructor', display: 'x',
        }, rootC);
        assert.ok(badSys.body.includes('角色名不可用'), badSys.body);
        const dom = await post('/domain/opend/manage/role', {
            action: 'create', role_name: 'longdom', display: 'D'.repeat(150),
        }, rootC);
        assert.strictEqual(dom.status, 200, dom.body);
        const d = storage.loadDomain('opend');
        assert.ok(d.roles.longdom, '域角色未创建');
        assert.strictEqual(d.roles.longdom.display.length, 100, '域角色显示名未截断');
        const badDom = await post('/domain/opend/manage/role', {
            action: 'create', role_name: 'prototype', display: 'x',
        }, rootC);
        assert.ok(badDom.body.includes('角色名不可用'), badDom.body);
    });
    await check('异常成员/封禁/申请结构不会导致页面 500', async () => {
        const original = storage.loadDomain('opend');
        const broken = JSON.parse(JSON.stringify(original));
        broken.members = { [dmodId]: null };
        broken.bans = { [viewerId]: null };
        broken.join_applications = { bad: true };
        broken.roles = 'bad';
        broken.perm_overrides = 'bad';
        storage.saveDomain('opend', broken);
        const users = await get('/domain/opend/users', rootC);
        assert.strictEqual(users.status, 200, users.body);
        for (const p of ['/domain/opend/manage/user',
            '/domain/opend/manage/role', '/domain/opend/manage/permission']) {
            const r = await get(p, rootC);
            assert.strictEqual(r.status, 200, p + ' ' + r.body);
        }
        const roleCreate = await post('/domain/opend/manage/role', {
            action: 'create', role_name: 'schemrole', display: 'schema',
        }, rootC);
        assert.strictEqual(roleCreate.status, 200, roleCreate.body);
        const permSave = await post('/domain/opend/manage/permission',
            { perm_guest: '0' }, rootC);
        assert.strictEqual(permSave.status, 200, permSave.body);
        const apps = await get('/domain/opend/manage/applications', rootC);
        assert.strictEqual(apps.status, 200, apps.body);
        const globalApps = await get('/manage/join_applications', rootC);
        assert.strictEqual(globalApps.status, 200, globalApps.body);
        const globalSingle = await post('/manage/join_applications',
            { domain_name: 'opend', uid: viewerId, action: 'reject' }, rootC);
        assert.strictEqual(globalSingle.status, 404, globalSingle.body);
        const join = await post('/domain/opend/join', { message: 'schema' }, viewerC);
        assert.ok(join.status < 400, join.body);
        const saved = storage.loadDomain('opend');
        assert.ok(Array.isArray(saved.join_applications), '申请列表未恢复为数组');
        assert.strictEqual(saved.join_applications.length, 1);
        assert.strictEqual(saved.join_applications[0].uid, viewerId);
        saved.join_applications.push(null);
        storage.saveDomain('opend', saved);
        const globalBatch = await post('/manage/join_applications', {
            application_ids: 'opend:' + viewerId, action: 'approve',
        }, rootC);
        assert.strictEqual(globalBatch.status, 200, globalBatch.body);
        assert.strictEqual(JSON.parse(globalBatch.body).ok, true, globalBatch.body);
        const transfer = await get('/domain/opend/manage/transfer', rootC);
        assert.strictEqual(transfer.status, 200, transfer.body);
        storage.saveDomain('opend', original);
    });
    await check('不存在的域管理页返回 404 且不写入数据', async () => {
        for (const p of [
            '/domain/missing/manage/user',
            '/domain/missing/manage/role',
            '/domain/missing/manage/permission',
            '/domain/missing/manage/discussions',
        ]) {
            const r = await get(p, rootC);
            assert.strictEqual(r.status, 404, p + ' status=' + r.status);
        }
        const r = await post('/domain/missing/manage/discussions',
            { action: 'create', name: 'ghost', title: 'x' }, rootC);
        assert.strictEqual(r.status, 404, 'POST status=' + r.status);
        assert.strictEqual(storage.domainExists('missing'), false, '不应创建不存在的域');
        assert.strictEqual(storage.loadDiscussion('missing', 'ghost').name, undefined);
    });
    await check('仅有 MANAGE_PANEL 不能访问 IP 封禁页', async () => {
        const r = await get('/manage/ip_bans', opsC);
        assert.strictEqual(r.status, 403, 'status=' + r.status);
        const ok = await get('/manage/permissions', opsC);
        assert.strictEqual(ok.status, 200, 'permissions status=' + ok.status);
    });
    await check('非超管不能通过权限矩阵给自己加 MANAGE_ALL', async () => {
        const forged = PRIV.SYSTEM.MANAGE_PANEL
            | PRIV.SYSTEM.MANAGE_SYS_PERMS | PRIV.SYSTEM.MANAGE_ALL;
        const r = await post('/manage/permissions',
            { 'priv_sysops.system': String(forged) }, opsC);
        assert.strictEqual(r.status, 200, 'status=' + r.status);
        assert.ok(r.body.includes('不能授予'), '未拒绝越权授权');
        sysRoles.invalidateCache();
        const saved = sysRoles.loadRoles().sysops.privs.system >>> 0;
        assert.strictEqual((saved & PRIV.SYSTEM.MANAGE_ALL) >>> 0, 0, 'MANAGE_ALL 被写入');
    });
    await check('非超管不能授予自己不具备权限的角色', async () => {
        const r = await post('/manage/users/role',
            { user_id: viewerId, role: 'admin' }, opsC);
        assert.strictEqual(r.status, 403, 'status=' + r.status);
        assert.strictEqual(storage.loadUser(viewerId).system_role, 'viewall');
    });
    await check('非超管不能修改其他系统管理员的角色', async () => {
        const r = await post('/manage/users/role',
            { user_id: adminId, role: 'guest' }, opsC);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false, r.body);
        assert.strictEqual(storage.loadUser(adminId).system_role, 'admin');
    });
    await check('域管理员不能授予自己不具备权限的角色', async () => {
        const r = await post('/domain/opend/manage/user',
            { action: 'grant', user_id: dmodId, role: 'ace' }, dmodC);
        assert.strictEqual(r.status, 403, 'status=' + r.status);
        assert.strictEqual(storage.loadDomain('opend').members[dmodId].role, 'dmod');
    });
    await check('不能给不存在的用户授予域角色', async () => {
        const ghost = 'ghost77';
        const r = await post('/domain/opend/manage/user',
            { action: 'grant', user_id: ghost, role: 'default' }, dmodC);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false, r.body);
        assert.ok(r.body.includes('用户不存在'), r.body);
        assert.strictEqual(storage.loadDomain('opend').members[ghost], undefined);
        assert.throws(() => auth.grantRole('opend', ghost, 'default'), /用户不存在/);
        assert.strictEqual(storage.loadDomain('opend').members[ghost], undefined);
        const ban = await post('/domain/opend/manage/user', {
            action: 'ban', user_id: ghost, until: '2099-12-31T23:59:59Z',
        }, rootC);
        assert.strictEqual(ban.status, 200, ban.body);
        assert.ok(ban.body.includes('用户不存在'), ban.body);
        const bans = storage.loadDomain('opend').bans || {};
        assert.strictEqual(bans[ghost], undefined);
    });
    await check('域资料文本超长会被截断', async () => {
        const r = await post('/domain/opend/manage/edit', {
            display_name: 'D'.repeat(150),
            announcement: 'A'.repeat(2500),
        }, rootC);
        assert.strictEqual(r.status, 200, r.body);
        const d = storage.loadDomain('opend');
        assert.strictEqual(d.display_name.length, 100, '显示名未截断');
        assert.strictEqual(d.announcement.length, 2000, '公告未截断');
    });
    await check('未知加入申请操作不会误删申请', async () => {
        const join = await post('/domain/opend/join',
            { message: 'M'.repeat(600) }, viewerC);
        assert.ok(join.status < 400, 'join status=' + join.status);
        const before = (storage.loadDomain('opend').join_applications || [])
            .find(a => a.uid === viewerId);
        assert.ok(before, '申请未创建');
        assert.strictEqual(before.message.length, 500, '申请留言未截断');
        const r = await post('/domain/opend/manage/applications',
            { uid: viewerId, action: 'bogus' }, rootC);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false, r.body);
        const after = (storage.loadDomain('opend').join_applications || [])
            .find(a => a.uid === viewerId);
        assert.ok(after, '未知操作误删了申请');
    });
    await finish('阶段3：文件与角色守卫');
})().catch(fatal);

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
    await check('登录“记住我”生成持久 Cookie，普通登录仍为会话 Cookie', async () => {
        const remembered = await post('/login',
            { nickname: 'mention0', password: 'pw123456', remember: '1' });
        const rememberedCookie = (remembered.headers['set-cookie'] || [])
            .find(c => /^token=/.test(c)) || '';
        assert.ok(/Max-Age=[1-9]\d*/.test(rememberedCookie),
            '记住我 Cookie 缺少正数 Max-Age: ' + rememberedCookie);
        assert.ok(/HttpOnly/.test(rememberedCookie), '缺少 HttpOnly');
        assert.ok(/SameSite=Lax/.test(rememberedCookie), '缺少 SameSite');
        const normal = await post('/login', { nickname: 'mention1', password: 'pw123456' });
        const normalCookie = (normal.headers['set-cookie'] || [])
            .find(c => /^token=/.test(c)) || '';
        assert.ok(!/Max-Age=/.test(normalCookie),
            '普通登录 Cookie 不应设置 Max-Age: ' + normalCookie);
    });
    await check('登录成功会轮换会话，旧 Cookie 立即失效', async () => {
        const first = await post('/login',
            { nickname: 'mention0', password: 'pw123456', remember: '1' });
        const oldCookie = cookieOf(first);
        const rotated = await post('/login',
            { nickname: 'mention0', password: 'pw123456' }, oldCookie);
        const newCookie = cookieOf(rotated);
        assert.ok(newCookie && newCookie !== oldCookie, '登录未轮换会话 Cookie');
        const oldHome = await get('/settings/security', oldCookie);
        assert.ok(oldHome.status >= 300 && oldHome.status < 400,
            '旧会话仍可访问, status=' + oldHome.status);
        const newHome = await get('/settings/security', newCookie);
        assert.strictEqual(newHome.status, 200, '新会话不可用, status=' + newHome.status);
    });
    await check('登录 return_to 拒绝编码的协议相对跳转', async () => {
        for (const raw of ['/%2f%2fevil.example', '/%5cevil.example']) {
            const r = await post('/login', {
                nickname: 'mention2', password: 'pw123456', return_to: raw,
            });
            assert.strictEqual(r.status, 200, '登录 status=' + r.status);
            assert.strictEqual(JSON.parse(r.body).redirect, '/home', raw);
        }
        const ok = await post('/login', {
            nickname: 'mention2', password: 'pw123456', return_to: '/domain/system',
        });
        assert.strictEqual(JSON.parse(ok.body).redirect, '/domain/system');
    });
    await check('审计日志页按权限开放', async () => {
        const page = await get('/manage/audit', opsC);
        assert.strictEqual(page.status, 200, '审计页 status=' + page.status);
        assert.ok(page.body.includes('审计日志'), '审计页内容缺失');
        const denied = await get('/manage/audit', viewerC);
        assert.strictEqual(denied.status, 403, '普通用户不应访问');
        const menu = await get('/manage', opsC);
        assert.ok(menu.body.includes('/manage/audit'), '管理菜单缺少审计入口');
        const exported = await get('/manage/audit/export?type=security', opsC);
        assert.strictEqual(exported.status, 200, '导出 status=' + exported.status);
        assert.ok(String(exported.headers['content-type'] || '')
            .includes('text/plain'), '导出类型错误');
        assert.ok(/^attachment/.test(exported.headers['content-disposition'] || ''),
            '导出应强制下载');
        assert.strictEqual(exported.headers['x-content-type-options'], 'nosniff');
        const deniedExport = await get('/manage/audit/export', viewerC);
        assert.strictEqual(deniedExport.status, 403, '普通用户不应导出');
    });
    await check('安全响应头与表单体硬上限生效', async () => {
        const page = await get('/login');
        assert.strictEqual(page.headers['x-permitted-cross-domain-policies'],
            'none', '缺少跨域策略头');
        assert.ok(String(page.headers['permissions-policy'] || '')
            .includes('camera=()'), '缺少权限策略头');
        assert.strictEqual(page.headers['cross-origin-opener-policy'], 'same-origin',
            '缺少 COOP 头');
        assert.strictEqual(page.headers['cross-origin-resource-policy'], 'same-origin',
            '缺少 CORP 头');
        assert.ok(/no-store/.test(String(page.headers['cache-control'] || '')),
            '动态响应缺少 no-store');
        assert.strictEqual(page.headers['strict-transport-security'], undefined,
            'HTTP 不应发送 HSTS');
        const csp = String(page.headers['content-security-policy'] || '');
        const nonce = (csp.match(/script-src[^;]*'nonce-([^']+)'/) || [])[1];
        assert.ok(nonce, 'script-src 缺少 nonce');
        assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp),
            'script-src 不应允许 unsafe-inline');
        assert.ok(/style-src[^;]*'unsafe-inline'/.test(csp),
            'style-src 应暂时保留 unsafe-inline');
        assert.ok(page.body.includes('nonce="' + nonce + '"'),
            'HTML 未使用响应 nonce');
        const payload = Buffer.alloc(2 * 1024 * 1024 + 1, 0x61);
        const big = await new Promise((resolve, reject) => {
            const r = http.request({
                host: '127.0.0.1', port: PORT, method: 'POST', path: '/login',
                headers: {
                    Origin: BASE,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': payload.length,
                },
            }, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => resolve({ status: res.statusCode, body: d }));
            });
            r.on('error', reject);
            r.end(payload);
        });
        assert.strictEqual(big.status, 413, '超大表单未拒绝, status=' + big.status);
        const bigData = JSON.parse(big.body);
        assert.strictEqual(bigData.ok, false, big.body);
        assert.ok(bigData.error, '缺少错误文案');
    });
    await finish('阶段3：登录与会话');
})().catch(fatal);

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { sleep, waitForServer, clearTestArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
const PORT = 5199;
const BASE = 'http://127.0.0.1:' + PORT;
const WS_URL = 'ws://127.0.0.1:' + PORT + '/ws/discuss/system/general';
const { PRIV, PERM, SYSTEM_ROLES_BUILTIN } = require('../../lib/permissions');
const { checkDual } = require('../../lib/auth/privilege');
const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
clearTestArtifacts(ROOT);
const storage = require('../../lib/storage');
const auth = require('../../lib/auth');
const sysRoles = require('../../lib/storage/system-roles');
storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();
const rootId = storage.createUser('rootx', 'pw123456');
const opsId = storage.createUser('opsx', 'pw123456');
const viewerId = storage.createUser('viewx', 'pw123456');
const adminId = storage.createUser('adminx', 'pw123456');
const dmodId = storage.createUser('dmodx', 'pw123456');
sysRoles.createRole('sysops', 'SysOps');
const opsPrivs = JSON.parse(JSON.stringify(SYSTEM_ROLES_BUILTIN.member.privs));
opsPrivs.base = (opsPrivs.base & ~PRIV.BASE.VIEW_ALL_DOMAIN) >>> 0;
opsPrivs.system = PRIV.SYSTEM.MANAGE_PANEL | PRIV.SYSTEM.MANAGE_SYS_PERMS;
sysRoles.saveRolePrivs('sysops', opsPrivs);
const opsUser = storage.loadUser(opsId);
opsUser.system_role = 'sysops';
storage.saveUser(opsId, opsUser);
sysRoles.createRole('viewall', 'ViewAll');
const viewPrivs = JSON.parse(JSON.stringify(SYSTEM_ROLES_BUILTIN.member.privs));
viewPrivs.base = viewPrivs.base | PRIV.BASE.VIEW_ALL_DOMAIN;
sysRoles.saveRolePrivs('viewall', viewPrivs);
const viewerUser = storage.loadUser(viewerId);
viewerUser.system_role = 'viewall';
storage.saveUser(viewerId, viewerUser);
auth.setSystemRole(adminId, 'admin');
storage.createDomain('opend', 'OpenD', rootId);
{
    const d = storage.loadDomain('opend');
    d.join_policy = 'approval';
    d.roles = d.roles || {};
    d.roles.ace = { display: 'Ace', perm: { hi: PERM.ALL.hi, lo: PERM.ALL.lo } };
    d.roles.dmod = {
        display: 'DMod',
        perm: { hi: 0, lo: (PERM.MANAGE.USER.lo | PERM.MANAGE.ROLE.lo) >>> 0 },
    };
    d.members[dmodId] = {
        role: 'dmod', level: 0, exp: 0, joined_at: storage.nowIso(),
    };
    storage.saveDomain('opend', d);
}
const mentionIds = [];
for (let i = 0; i < 30; i++) mentionIds.push(storage.createUser('mention' + i, 'pw123456'));
{
    const d = storage.loadDomain('opend');
    for (const id of mentionIds) {
        d.members[id] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
    }
    storage.saveDomain('opend', d);
}
const privateFile = storage.addUserFile(rootId, {
    filename: 'secret.txt', mime: 'text/plain',
    buffer: Buffer.from('private-content'), visibility: 'private',
});
const publicFile = storage.addUserFile(rootId, {
    filename: 'open.txt', mime: 'text/plain',
    buffer: Buffer.from('public-content'), visibility: 'public',
});
const htmlFile = storage.addUserFile(rootId, {
    filename: 'evil.html', mime: 'text/html',
    buffer: Buffer.from('<script>alert(1)</script>'), visibility: 'public',
});
const textFile = storage.addUserFile(rootId, {
    filename: 'note.txt', mime: 'text/plain',
    buffer: Buffer.from('<script>alert(1)</script>'), visibility: 'public',
});
function request(method, p, { body, cookie, headers, origin = true } = {}) {
    return new Promise((resolve, reject) => {
        const h = Object.assign({}, headers || {});
        if (origin) h.Origin = origin === true ? BASE : origin;
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => resolve({
                    status: res.statusCode, headers: res.headers, body: d,
                }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
const get = (p, cookie) => request('GET', p, { cookie });
const post = (p, body, cookie) => request('POST', p, { body, cookie });
const cookieOf = r => (r.headers['set-cookie'] || [])
    .map(c => c.split(';')[0]).join('; ');
const tryOpen = ws => new Promise(r => {
    ws.on('open', () => r(true));
    ws.on('error', () => r(false));
    setTimeout(() => r(false), 2500);
});
const waitClose = ws => new Promise(r => {
    if (ws.readyState === WebSocket.CLOSED) return r(true);
    ws.on('close', () => r(true));
    setTimeout(() => r(false), 2500);
});
let proc = null;
(async () => {
    await check('VIEW_ALL_DOMAIN 非成员只读，不能发送消息', () => {
        const viewer = storage.loadUser(viewerId);
        const du = auth.getDomainUser('opend', viewer);
        assert.strictEqual(du.is_member, false);
        assert.strictEqual(du.role, 'guest');
        checkDual(viewer, du, 'view_discussion');
        assert.throws(() => checkDual(viewer, du, 'send_message'));
    });
    await check('非成员系统管理员无 VIEW_ALL 时仍不能进入域', () => {
        const ops = storage.loadUser(opsId);
        const du = auth.getDomainUser('opend', ops);
        assert.strictEqual(du.role, 'guest');
        assert.throws(() => checkDual(ops, du, 'send_message'));
    });
    await check('提及解析可正常读取域成员并限制通知数量', () => {
        const guard = require('../../lib/websocket/discuss-guard');
        const sender = storage.loadUser(rootId);
        const du = auth.getDomainUser('opend', sender);
        const content = mentionIds.map(id => '@[' + id + ']').join(' ');
        const r = guard.parseMentions(content, 'opend', sender, du);
        assert.ok(guard.MAX_MENTIONS > 0 && guard.MAX_MENTIONS <= guard.MAX_MENTION_TOKENS);
        assert.strictEqual(r.mentions.length, guard.MAX_MENTIONS);
        assert.ok(r.silent.length <= guard.MAX_MENTIONS);
    });
    await check('非法 reply_to 不会被写入或用于回复奖励', () => {
        const { normalizeMessageId } = require('../../lib/websocket/discuss');
        assert.strictEqual(normalizeMessageId('a'.repeat(65)), '');
        assert.strictEqual(normalizeMessageId({}), '');
        assert.strictEqual(normalizeMessageId(null), '');
        assert.strictEqual(normalizeMessageId('abc_DEF-123'), 'abc_DEF-123');
    });
    await check('requireSystemAdmin 按页面权限位判定，MANAGE_PANEL 不能兜底', () => {
        const { requireSystemAdmin } = require('../../lib/routes/manage/_helpers');
        const stub = () => ({ headers: {}, writeHead() {}, end() {} });
        const ops = storage.loadUser(opsId);
        const root = storage.loadUser(rootId);
        assert.strictEqual(requireSystemAdmin(ops, stub(), 'permissions'), true);
        assert.strictEqual(requireSystemAdmin(ops, stub(), 'ip_bans'), false);
        assert.strictEqual(requireSystemAdmin(ops, stub(), 'system_roles'), false);
        assert.strictEqual(requireSystemAdmin(root, stub(), 'ip_bans'), true);
    });
    await check('系统账户与自身不可被封禁', () => {
        assert.throws(() => auth.banUserGlobally(storage.SYSTEM_UID, 'x', '', rootId),
            /系统账户/);
        assert.throws(() => auth.banUserGlobally(opsId, 'x', '', opsId), /自己/);
        assert.throws(() => auth.banUserInDomain('opend', storage.SYSTEM_UID, 'x', '', { id: rootId }),
            /系统账户/);
    });
    await check('系统管理员不能被同级禁言，也不能禁言域所有者', () => {
        const ops = storage.loadUser(opsId);
        const root = storage.loadUser(rootId);
        assert.strictEqual(auth.canMuteUser(ops, 'opend', adminId).ok, false);
        assert.strictEqual(auth.canMuteUser(ops, 'opend', storage.SYSTEM_UID).ok, false);
        assert.strictEqual(auth.canMuteUser(ops, 'opend', rootId).ok, false);
        assert.strictEqual(auth.canMuteUser(root, 'opend', adminId).ok, true);
    });
    await check('会话绑定 UA/IP 后缺失指纹会失效', () => {
        const sessions = require('../../lib/auth/sessions');
        const t1 = sessions.createSession('u-miss-ua', { ua: 'UA/1', ip: '10.9.0.1' });
        assert.strictEqual(sessions.getSessionUser(t1, { ip: '10.9.0.1' }), null);
        const t2 = sessions.createSession('u-miss-ip', { ua: 'UA/2', ip: '10.9.0.2' });
        assert.strictEqual(sessions.getSessionUser(t2, { ua: 'UA/2' }), null);
    });
    await check('WebSocket 会话守卫在会话销毁后失效', () => {
        const { sessionValid } = require('../../lib/websocket/session-guard');
        const token = auth.createSession('u-ws-guard', { ua: 'UA/W', ip: '10.9.0.3' });
        const ws = { _token: token, _ua: 'UA/W', _ip: '10.9.0.3' };
        assert.strictEqual(sessionValid(ws, 'u-ws-guard'), true);
        auth.destroySession(token);
        assert.strictEqual(sessionValid(ws, 'u-ws-guard'), false);
    });
    await check('敏感操作接入了限流', () => {
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/avatar.js'), 'utf8');
        assert.ok(src.includes("limiter.check('upload_file'"), '头像上传未接入限流');
        const profile = fs.readFileSync(path.join(ROOT, 'lib/routes/user.js'), 'utf8');
        assert.ok(profile.includes("limiter.check('upload_file'"), '资料页头像上传未接入限流');
        assert.ok(profile.includes("limiter.check('change_password'"), '修改密码未接入限流');
    });
    await check('密码策略拒绝空密码、过短或过长的密码', () => {
        const { validatePassword } = require('../../lib/auth/password-policy');
        assert.throws(() => validatePassword(''), /不能为空/);
        assert.throws(() => validatePassword('1234567'), /不能少于/);
        assert.throws(() => validatePassword('a'.repeat(129)), /不能超过/);
        assert.strictEqual(validatePassword('12345678'), true);
        const account = require('../../lib/auth/account');
        assert.throws(() => account.registerUser('weakpwd', ''), /不能为空/);
        assert.throws(() => account.registerUser('weakpwd', '1234567'), /不能少于/);
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/register.html'), 'utf8');
        assert.ok(tpl.includes('minlength="8"'), '注册页应限制密码最短长度');
    });
    await check('登录失败达到阈值会触发聚合告警', () => {
        const alerts = require('../../lib/auth/login-alert');
        const logger = require('../../lib/logger');
        const seen = [];
        const orig = logger.security;
        alerts.reset();
        logger.security = (action, ip, detail) => seen.push({ action, ip, detail });
        try {
            for (let i = 0; i < alerts.THRESHOLD; i++) {
                alerts.record('alertuser', '10.7.0.' + i);
            }
        } finally {
            logger.security = orig;
            alerts.reset();
        }
        assert.ok(seen.some(e => e.action === 'LOGIN_ALERT'
            && String(e.detail).includes('dim=account')), '未触发账号维度告警');
    });
    await check('会话指纹变化会记录重放嫌疑', () => {
        const sessions = require('../../lib/auth/sessions');
        const logger = require('../../lib/logger');
        const token = sessions.createSession('u-replay', {
            ua: 'UA/Replay', ip: '10.8.0.1',
        });
        const seen = [];
        const orig = logger.security;
        logger.security = (action, ip, detail) => seen.push({ action, ip, detail });
        try {
            sessions.getSessionUser(token, { ua: 'UA/Replay', ip: '10.8.0.2' });
        } finally {
            logger.security = orig;
            sessions.destroySession(token);
        }
        assert.ok(seen.some(e => e.action === 'SESSION_REPLAY_SUSPECT'
            && String(e.detail).includes('dim=ip')), '未记录 IP 变化');
    });
    await check('会话列表只暴露摘要且可按摘要定位', () => {
        const sessions = require('../../lib/auth/sessions');
        const token = sessions.createSession('u-sid', {
            ua: 'UA/Sid', ip: '10.9.0.1',
        });
        try {
            const item = sessions.listSessions().find(s => s.uid === 'u-sid');
            assert.ok(item && /^[a-f0-9]{16}$/.test(item.sid), '缺少会话摘要');
            assert.ok(!('token' in item), '不应暴露原始令牌');
            const hit = sessions.findSessionBySid(item.sid);
            assert.ok(hit && hit.token === token, '摘要无法定位会话');
            assert.strictEqual(sessions.findSessionBySid('bad'), null);
        } finally {
            sessions.destroySession(token);
        }
    });
    await check('日志会对敏感查询参数脱敏', () => {
        const { redact } = require('../../lib/logger');
        assert.strictEqual(
            redact('/login?token=abc&password=def&ok=1'),
            '/login?token=***&password=***&ok=1');
    });
    await check('登录失败与限流会写入安全日志', () => {
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/auth.js'), 'utf8');
        assert.ok(src.includes("logger.security('LOGIN_FAIL'"), '登录失败未记录');
        assert.ok(src.includes("logger.security('LOGIN_BLOCKED'"), '登录限流未记录');
    });
    await check('上传文件实际大小超过上限会被拒绝', () => {
        const { handleUpload } = require('../../lib/routes/files');
        const boundary = '----stage3';
        const payload = Buffer.alloc(1024 * 1024 + 1, 0x41);
        const rawBody = Buffer.concat([
            Buffer.from(`--${boundary}\r\n`
                + 'Content-Disposition: form-data; name="file"; filename="big.txt"\r\n'
                + 'Content-Type: text/plain\r\n\r\n'),
            payload,
            Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        let stored = false;
        const res = { writeHead() {}, end(body) { this.body = body; } };
        handleUpload(res, rawBody, {
            headers: { 'content-type': 'multipart/form-data; boundary=' + boundary },
        }, 1, () => { stored = true; return { id: 'x', filename: 'big.txt' }; });
        assert.strictEqual(stored, false, '超限文件被写入');
        assert.ok(String(res.body).includes('超过'), '未返回超限错误');
    });
    await check('multipart 解析限制部件数与字段名长度', () => {
        const { parseMultipart } = require('../../lib/http-utils');
        let body = '';
        for (let i = 0; i < 200; i++) {
            body += `--X\r\nContent-Disposition: form-data; name="f${i}"\r\n\r\nv\r\n`;
        }
        body += '--X--\r\n';
        const parsed = parseMultipart(Buffer.from(body), 'X');
        assert.ok(Object.keys(parsed).length <= 100, '部件数未被限制');
        const longName = 'n'.repeat(500);
        const one = `--X\r\nContent-Disposition: form-data; name="${longName}"\r\n\r\nv\r\n--X--\r\n`;
        assert.deepStrictEqual(parseMultipart(Buffer.from(one), 'X'), {},
            '超长字段名未被拒绝');
    });
    await check('审计日志提取支持类型过滤', () => {
        const dir = path.join(ROOT, 'logs');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, '2099-12-31.log');
        fs.writeFileSync(file,
            '2026-01-01 [Audit] actor=root POST /manage/users\n'
            + '2026-01-01 [Security] LOGIN_FAIL nickname=x\n');
        try {
            const auditLog = require('../../lib/audit-log');
            const all = auditLog.events({ kind: 'all', limit: 10 });
            assert.ok(all.some(l => l.includes('[Audit]')), '缺少 Audit');
            assert.ok(all.some(l => l.includes('[Security]')), '缺少 Security');
            const sec = auditLog.events({ kind: 'security', limit: 10 });
            assert.ok(sec.length > 0 && sec.every(l => l.includes('[Security]')),
                '类型过滤错误');
            const one = auditLog.events({ kind: 'all', limit: 1, offset: 1 });
            assert.deepStrictEqual(one, [all[1]], '分页偏移错误');
        } finally {
            fs.rmSync(file, { force: true });
        }
    });
    await check('管理写操作接入审计日志', () => {
        const idx = fs.readFileSync(path.join(ROOT, 'lib/routes/index.js'), 'utf8');
        assert.ok(idx.includes('isAuditRequest(req.method, pathname)'), '未判定审计路径');
        assert.ok(idx.includes('logger.audit('), '未写入审计日志');
        const log = fs.readFileSync(path.join(ROOT, 'lib/logger.js'), 'utf8');
        assert.ok(log.includes('[Audit]'), '日志格式缺少 Audit 标识');
    });
    proc = spawn(process.execPath, ['server.js'],
        { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});
    await waitForServer(PORT);
    const rootC = cookieOf(await post('/login', { nickname: 'rootx', password: 'pw123456' }));
    const opsC = cookieOf(await post('/login', { nickname: 'opsx', password: 'pw123456' }));
    const viewerC = cookieOf(await post('/login', { nickname: 'viewx', password: 'pw123456' }));
    const dmodC = cookieOf(await post('/login', { nickname: 'dmodx', password: 'pw123456' }));
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
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/login.html'), 'utf8');
        assert.ok(tpl.includes('name="remember"'), '登录页缺少记住我选项');
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
    await check('未知加入申请操作不会误删申请', async () => {
        const join = await post('/domain/opend/join', { message: 'hi' }, viewerC);
        assert.ok(join.status < 400, 'join status=' + join.status);
        const before = (storage.loadDomain('opend').join_applications || [])
            .find(a => a.uid === viewerId);
        assert.ok(before, '申请未创建');
        const r = await post('/domain/opend/manage/applications',
            { uid: viewerId, action: 'bogus' }, rootC);
        assert.strictEqual(r.status, 200, r.body);
        assert.strictEqual(JSON.parse(r.body).ok, false, r.body);
        const after = (storage.loadDomain('opend').join_applications || [])
            .find(a => a.uid === viewerId);
        assert.ok(after, '未知操作误删了申请');
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
    proc.kill();
    await sleep(300);
    clearTestArtifacts(ROOT);
    if (!results.some(r => r[0] === 'FAIL')) {
        try { fs.rmSync(path.join(ROOT, 'logs'), { recursive: true, force: true }); } catch (e) {}
    }
    console.log('\n======== [回归] 阶段3：认证/权限/安全守卫 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})().catch(async e => {
    console.error('SUITE ERROR', e && e.message);
    try { if (proc) proc.kill(); } catch (e2) {}
    clearTestArtifacts(ROOT);
    process.exit(2);
});

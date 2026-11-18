'use strict';
const {
    assert, fs, path, http, WebSocket, sleep, ROOT, PORT, BASE, WS_URL,
    PRIV, PERM, SYSTEM_ROLES_BUILTIN, checkDual, check, storage, auth,
    sysRoles, rootId, opsId, viewerId, adminId, dmodId, mentionIds,
    privateFile, publicFile, htmlFile, textFile, request, get, post,
    cookieOf, tryOpen, waitClose, startServer, loginUsers, finish, fatal,
} = require('./_stage3-common');
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
    await check('密码策略拒绝空密码和过长密码，不再限制最短长度', () => {
        const { validatePassword } = require('../../lib/auth/password-policy');
        assert.throws(() => validatePassword(''), /不能为空/);
        assert.strictEqual(validatePassword('1'), true);
        assert.throws(() => validatePassword('a'.repeat(129)), /不能超过/);
        assert.strictEqual(validatePassword('12345678'), true);
        const account = require('../../lib/auth/account');
        assert.throws(() => account.registerUser('weakpwd', ''), /不能为空/);
        assert.ok(account.registerUser('shortpwd', '1'));
    });
    await check('登录拒绝空密码和超长密码，不进入密码哈希', () => {
        const account = require('../../lib/auth/account');
        const { MAX_LENGTH } = require('../../lib/auth/password-policy');
        const uid = storage.findUserByNickname('shortpwd').id;
        const original = storage.verifyPassword;
        let called = false;
        storage.verifyPassword = () => { called = true; return false; };
        try {
            assert.strictEqual(account.login('shortpwd', '', '127.0.0.1'), null);
            assert.strictEqual(
                account.login('shortpwd', 'a'.repeat(MAX_LENGTH + 1), '127.0.0.1'), null);
            assert.throws(() => account.changePassword(uid, '', 'newpass'), /原密码错误/);
            assert.throws(
                () => account.changePassword(uid, 'a'.repeat(MAX_LENGTH + 1), 'newpass'),
                /原密码错误/);
        } finally {
            storage.verifyPassword = original;
        }
        assert.strictEqual(called, false, '空/超长密码不应进入 scrypt');
        assert.strictEqual(account.login('shortpwd', '1', '127.0.0.1'), uid);
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
    await finish('阶段3：认证/权限/安全守卫（核心）');
})().catch(fatal);

// [回归] 特权用户能力未被收窄的 skipPriv 改动破坏 + 前几轮关键不变量
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DATA = 'D:/chatroom/data';
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const storage = require('D:/chatroom/lib/storage');
const auth = require('D:/chatroom/lib/auth');
const { PRIV, PERM, hasPriv } = require('D:/chatroom/lib/permissions');
const { checkDual } = require('D:/chatroom/lib/auth/privilege');

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

storage.ensureDirs(); storage.ensureSystemDomain(); storage.ensureSystemUser();
const rootId = storage.createUser('rootu', 'pw123456');
const sysId = storage.createUser('sysad', 'pw123456');
const ownerId = storage.createUser('ownu', 'pw123456');   // 系统角色 member
const memberId = storage.createUser('memb', 'pw123456');
auth.setSystemRole(sysId, 'admin');
storage.createDomain('gdom', 'G', ownerId);
auth.grantRole('gdom', ownerId, 'owner');
auth.grantRole('gdom', memberId, 'default');

const OWNER = storage.loadUser(ownerId);   // 系统角色 member + 域角色 owner → 特权
const MEMBER = storage.loadUser(memberId);
const SYSAD = storage.loadUser(sysId);
const ROOT = storage.loadUser(rootId);

// ================= 特权用户能力完整性 =================
check('域所有者仍可执行全部域级操作', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['edit_domain', 'manage_join', 'transfer_domain', 'delete_domain']) {
        checkDual(OWNER, du, op);
    }
});
check('域所有者仍可管理成员（禁言/踢出/角色）', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['mute_member', 'kick_member', 'manage_user', 'manage_role']) {
        checkDual(OWNER, du, op);
    }
});
check('域所有者仍可发消息/表情/置顶/撤回', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['send_message', 'add_reaction', 'pin_message']) {
        checkDual(OWNER, du, op);
    }
    checkDual(OWNER, du, 'revoke_message', true);
    checkDual(OWNER, du, 'delete_message', false);
});
check('域所有者仍可查看讨论与文件', () => {
    const du = auth.getDomainUser('gdom', OWNER);
    for (const op of ['view_discussion', 'create_discussion', 'view_file', 'upload_file']) {
        checkDual(OWNER, du, op);
    }
});
check('系统管理员（MANAGE_PANEL）不受影响', () => {
    const du = auth.getDomainUser('gdom', SYSAD);
    assert.strictEqual(du.is_privileged, true);
    for (const op of ['send_message', 'pin_message', 'kick_member', 'edit_domain']) {
        checkDual(SYSAD, du, op);
    }
});
check('超管不受影响', () => {
    const du = auth.getDomainUser('gdom', ROOT);
    for (const op of ['send_message', 'pin_message', 'kick_member', 'edit_domain', 'delete_domain']) {
        checkDual(ROOT, du, op);
    }
});
check('普通成员的基础能力未被放宽', () => {
    const du = auth.getDomainUser('gdom', MEMBER);
    checkDual(MEMBER, du, 'send_message');
    let denied = false;
    try { checkDual(MEMBER, du, 'edit_domain'); } catch (e) { denied = true; }
    assert.ok(denied, '普通成员通过了 edit_domain');
});

// ================= 前几轮关键不变量 =================
check('r2: exp 立即落盘（无 5 秒缓冲）', () => {
    const src = fs.readFileSync('D:/chatroom/lib/auth/exp.js', 'utf8');
    assert.ok(!/setTimeout|pending\.set/.test(src), 'exp 仍有缓冲/定时器');
});
check('r1: 昵称索引不受 Object.prototype 昵称影响', () => {
    const users = require('D:/chatroom/lib/storage/users');
    for (const n of ['toString', '__proto__', 'constructor']) {
        assert.strictEqual(users.findUserByNickname(n), null);
    }
});
check('r1: 原型污染防护仍在（权限矩阵）', () => {
    const src = fs.readFileSync('D:/chatroom/lib/routes/manage/system-roles.js', 'utf8');
    assert.ok(/Object\.create\(null\)/.test(src), '权限矩阵仍使用普通对象');
});
check('r1: 文件 ID 拒绝 __proto__', () => {
    const uf = require('D:/chatroom/lib/storage/user-files');
    assert.throws(() => uf.setUserFileVisibility(memberId, '__proto__', 'public'));
    assert.strictEqual({}.visibility, undefined);
});
check('r2: 社交操作不会为不存在的 uid 建目录', () => {
    const social = require('D:/chatroom/lib/storage/social');
    assert.strictEqual(social.unfollow(memberId, 'ghost88'), false);
    assert.ok(!fs.readdirSync(path.join(DATA, 'users')).includes('ghost88'));
});
check('r5: 全部模板可解析', () => {
    const { env } = require('D:/chatroom/lib/template.js');
    const dir = 'D:/chatroom/templates';
    const errs = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.html')) continue;
        try {
            env.render(f, {
                all_members: [], users: [], messages: [], domains: [], roles: [],
                groups: {}, conversations: [], current_user: {}, nav: {}, domain: {},
                files: [], domain_name: 'd1', results: [], can_mute: false, list: [],
                applications: [], config: {}, is_system: false, pending_count: 0,
                can_create_discuss: false, can_delete_discuss: false, can_edit_discuss: false,
            });
        } catch (e) { errs.push(f); }
    }
    assert.strictEqual(errs.length, 0, '解析失败: ' + errs.join(','));
});
check('r5: manage 入口仍按双检显隐', () => {
    const src = fs.readFileSync('D:/chatroom/templates/manage_domain.html', 'utf8');
    for (const f of ['can_edit', 'can_discussions', 'can_role', 'can_permission', 'can_manage_users']) {
        assert.ok(src.includes(`{% if ${f} %}`), f + ' 门控丢失');
    }
});
check('r6: 封禁时间校验统一且严格', () => {
    assert.strictEqual(auth.normalizeUntil('2099-99-99T99:99:99'), null);
    assert.strictEqual(auth.normalizeUntil('2024-02-30T12:00'), null);
    assert.strictEqual(auth.normalizeUntil('9999-12-31T23:59:59'), '9999-12-31T23:59:59Z');
    const admin = fs.readFileSync('D:/chatroom/lib/routes/admin.js', 'utf8');
    assert.ok(!/function normalizeUntil\(/.test(admin), '仍有重复实现');
});
check('r7: IP 封禁会断开已建立连接', () => {
    const src = fs.readFileSync('D:/chatroom/lib/websocket/kick.js', 'utf8');
    assert.ok(/function kickByIpRule/.test(src));
    assert.ok(/isIpBanned/.test(fs.readFileSync('D:/chatroom/lib/websocket/discuss.js', 'utf8')));
    assert.ok(/kickByIpRule/.test(fs.readFileSync('D:/chatroom/lib/routes/manage/ip-bans.js', 'utf8')));
});
check('r7: WS 升级限流存在且阈值合理', () => {
    const src = fs.readFileSync('D:/chatroom/lib/websocket/index.js', 'utf8');
    const m = /const UPGRADE_MAX = (\d+)/.exec(src);
    assert.ok(m && +m[1] >= 20, '阈值过低: ' + (m && m[1]));
});
check('r8: 日志轮转有界（不复用同名文件无限追加）', () => {
    const src = fs.readFileSync('D:/chatroom/lib/logger.js', 'utf8');
    assert.ok(!/rotateIfNeeded/.test(src), '仍使用改名轮转（EBUSY 风险）');
    assert.ok(/unlinkSync\(old\)/.test(src), '循环复用槽位前未删除旧文件');
});

// ================= 本轮新增 =================
check('登录限流：连续失败后被拦截，成功后清零', () => {
    const rl = require('D:/chatroom/lib/auth/rate-limit');
    // 账号维度阈值是 8
    for (let i = 0; i < 8; i++) rl.noteFailure('victim', '10.1.1.1');
    assert.ok(rl.checkLoginAllowed('victim', '10.1.1.1'), '账号维度未拦截');
    // 此时 IP 计数 8 < 30，尚未触发 IP 维度（由下一个用例覆盖）
    rl.noteSuccess('victim', '10.1.1.1');
    assert.strictEqual(rl.checkLoginAllowed('victim', '10.1.1.1'), null, '成功后未清零');
    assert.strictEqual(rl.checkLoginAllowed('other', '10.1.1.1'), null,
        '成功后该 IP 的其它账号仍被拦截');
});
check('登录限流：按 IP 维度独立计数', () => {
    const rl = require('D:/chatroom/lib/auth/rate-limit');
    for (let i = 0; i < 30; i++) rl.noteFailure('u' + i, '10.2.2.2');
    assert.ok(rl.checkLoginAllowed('fresh', '10.2.2.2'), 'IP 维度阈值未生效');
    assert.strictEqual(rl.checkLoginAllowed('fresh', '10.3.3.3'), null, '误伤其它 IP');
});
check('登录限流已接入登录路由', () => {
    const src = fs.readFileSync('D:/chatroom/lib/routes/auth.js', 'utf8');
    assert.ok(/checkLoginAllowed/.test(src), '登录前未检查限流');
    assert.ok(/noteLoginFailure/.test(src), '失败未计数');
    assert.ok(/clearLoginFailures/.test(src), '成功未清零');
    assert.ok(src.indexOf('checkLoginAllowed') < src.indexOf('auth.login('),
        '限流检查必须早于密码校验（否则 scrypt 仍可被无限次调用）');
});
check('启动自检存在且先于监听端口', () => {
    const src = fs.readFileSync('D:/chatroom/server.js', 'utf8');
    assert.ok(/startupCheck\.run/.test(src), '未调用自检');
    assert.ok(src.indexOf('startupCheck.run') < src.indexOf('server.listen'),
        '自检未在 listen 之前');
});
check('优雅关闭：关闭 HTTP + 断开 WS + 有超时兜底', () => {
    const src = fs.readFileSync('D:/chatroom/server.js', 'utf8');
    assert.ok(/SIGTERM/.test(src) && /SIGINT/.test(src), '缺少信号处理');
    assert.ok(/server\.close/.test(src), '未关闭 HTTP');
    assert.ok(/registry/.test(src) && /ws\.close\(1001/.test(src), '未断开 WebSocket');
    assert.ok(/setTimeout/.test(src) && /强制退出/.test(src), '缺少超时兜底');
});
check('依赖无已知漏洞（npm audit 报告）', () => {
    const r = require('child_process').spawnSync('npm.cmd',
        ['audit', '--registry=https://registry.npmjs.org'],
        { cwd: 'D:/chatroom', encoding: 'utf8', timeout: 180000, shell: true });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.ok(/found 0 vulnerabilities/.test(out),
        'npm audit 未通过:\n' + out.slice(-400));
});

console.log('\n======== [回归] 特权能力与历史不变量 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
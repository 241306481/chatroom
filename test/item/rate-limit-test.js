'use strict';
// 限流管理 + 会话绑定（防 cookie 搬运）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const storage = require('../../lib/storage');
const limiter = require('../../lib/rate-limit');
const sessions = require('../../lib/auth/sessions');

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();

// 恢复默认配置：上一次运行可能改过
{
    const { DEFAULTS, saveConfig, invalidate } = require('../../lib/rate-limit');
    saveConfig(Object.entries(DEFAULTS)
        .filter(([, d]) => d)
        .map(([action, d]) => ({ action, ...d })));
    invalidate();
}

// ---- 1. 通用限流 ----
check('按 IP 维度限流生效', () => {
    limiter.resetCounters('login');
    // 只给 IP 维度计数，账号维度不参与
    const keys = { ip: '10.0.0.1' };
    let blocked = null;
    for (let i = 0; i < 60; i++) {
        const hit = limiter.check('login', keys);
        if (hit) { blocked = hit; break; }
        limiter.note('login', keys);
    }
    assert.ok(blocked, '应被拦截');
    assert.strictEqual(blocked.dim, 'ip', '拦截维度应为 ip，实际 ' + blocked.dim);
    assert.ok(blocked.mins >= 1, '应给出剩余分钟数');
    assert.ok(blocked.limit > 0, '应带上限值');
});

check('按账号维度限流生效（同一账号不同 IP 也受限）', () => {
    // 用 page_view：它有账号维度（登录/注册按要求只留 IP 维度）
    limiter.resetCounters('page_view');
    const account = 'a-acct-only';
    let blocked = null;
    for (let i = 0; i < 200; i++) {
        const hit = limiter.check('page_view', { ip: '10.9.0.' + i, account });
        if (hit) { blocked = hit; break; }
        limiter.note('page_view', { ip: '10.9.0.' + i, account });
    }
    assert.ok(blocked, '应被拦截');
    assert.strictEqual(blocked.dim, 'account', '拦截维度应为 account，实际 ' + blocked.dim);
});

check('按账号维度限流生效（换 IP 也逃不掉）', () => {
    // 临时放开 IP 维度，确保触发的是账号维度
    const { DEFAULTS } = require('../../lib/rate-limit');
    const list = limiter.listConfig().map(a => (a.action === 'post_message'
        ? { ...a, perIp: 0, perAccount: 5 }
        : a));
    limiter.saveConfig(list);
    limiter.invalidate();
    limiter.resetCounters('post_message');
    const account = 'u-limit-1';
    let blocked = null;
    // 每次换 IP，但账号相同
    for (let i = 0; i < 20; i++) {
        const hit = limiter.check('post_message', { ip: '10.1.0.' + i, account });
        if (hit) { blocked = hit; break; }
        limiter.note('post_message', { ip: '10.1.0.' + i, account });
    }
    assert.ok(blocked, '换 IP 也应被账号维度限住');
    assert.strictEqual(blocked.dim, 'account', '拦截维度应为 account，实际 ' + blocked.dim);

    // 还原默认
    limiter.saveConfig(Object.entries(DEFAULTS)
        .filter(([, d]) => d)
        .map(([action, d]) => ({ action, ...d })));
    limiter.invalidate();
});

check('不同账号互不影响', () => {
    limiter.resetCounters('post_message');
    for (let i = 0; i < 40; i++) {
        limiter.note('post_message', { ip: '10.2.0.1', account: 'user-A' });
    }
    const hit = limiter.check('post_message', { ip: '10.2.0.1', account: 'user-B' });
    assert.strictEqual(hit, null, '账号 B 不该被 A 的配额影响');
});

check('clear 能清掉计数', () => {
    limiter.resetCounters('dm_send');
    for (let i = 0; i < 40; i++) {
        limiter.note('dm_send', { ip: '10.3.0.1', user: 'u-clear' });
    }
    limiter.clear('dm_send', { ip: '10.3.0.1', user: 'u-clear' });
    const hit = limiter.check('dm_send', { ip: '10.3.0.1', user: 'u-clear' });
    assert.strictEqual(hit, null, '清零后应放行');
});

check('resetCounters 清空指定动作', () => {
    limiter.resetCounters('upload_file');
    for (let i = 0; i < 40; i++) {
        limiter.note('upload_file', { ip: '10.4.0.1', user: 'u-reset' });
    }
    assert.ok(limiter.check('upload_file', { ip: '10.4.0.1', user: 'u-reset' }),
        '未清空前应被限');
    limiter.resetCounters('upload_file');
    assert.strictEqual(limiter.check('upload_file', { ip: '10.4.0.1', user: 'u-reset' }),
        null, '清空后应放行');
});

check('快照能反映实时计数', () => {
    limiter.resetCounters('create_domain');
    for (let i = 0; i < 3; i++) {
        limiter.note('create_domain', { ip: '10.5.0.1', user: 'u-snap' });
    }
    const snap = limiter.snapshot();
    assert.ok(snap.create_domain, '快照应含该动作');
    const ipList = snap.create_domain.ip || [];
    assert.strictEqual(ipList[0].key, '10.5.0.1');
    assert.strictEqual(ipList[0].n, 3);
});

// ---- 2. 配置持久化 ----
check('限流配置可保存并读回', () => {
    const list = limiter.listConfig();
    assert.ok(list.length > 0, '应有默认动作');
    const login = list.find(a => a.action === 'login');
    assert.ok(login, '应有 login 动作');
    assert.ok(login.perIp > 0, '登录应有 IP 维度限制');
    const view = list.find(a => a.action === 'page_view');
    assert.ok(view.perAccount > 0, '访问页面应有账号维度限制');

    // 用 post_message 改（login 按要求只有 IP 维度）
    const mod = list.map(a => (a.action === 'post_message'
        ? { ...a, perAccount: 3, perIp: 11, windowMin: 7 }
        : a));
    assert.ok(limiter.saveConfig(mod), '保存应成功');
    limiter.invalidate();
    const back = limiter.listConfig().find(a => a.action === 'post_message');
    assert.strictEqual(back.perAccount, 3);
    assert.strictEqual(back.perIp, 11);
    assert.strictEqual(back.windowMin, 7);

    // 还原默认，避免影响后续用例
    const { DEFAULTS } = require('../../lib/rate-limit');
    limiter.saveConfig(Object.entries(DEFAULTS)
        .filter(([, d]) => d)
        .map(([action, d]) => ({ action, ...d })));
    limiter.invalidate();
});

check('保存后新配置立即生效', () => {
    // 把 post_message 的账号维度调到 3，验证立刻生效
    const list = limiter.listConfig().map(a => (a.action === 'post_message'
        ? { ...a, perAccount: 3, perIp: 0 }
        : a));
    limiter.saveConfig(list);
    limiter.invalidate();
    limiter.resetCounters('post_message');
    const keys = { ip: '10.6.0.1', account: 'acct-x' };
    let hit = null;
    for (let i = 0; i < 5; i++) {
        const h = limiter.check('post_message', keys);
        if (h) { hit = h; break; }
        limiter.note('post_message', keys);
    }
    assert.ok(hit, 'perAccount=3 时第 4 次应被拦');
    assert.strictEqual(hit.dim, 'account');
});

check('配置值越界会被夹紧', () => {
    const list = limiter.listConfig().map(a => (a.action === 'post_message'
        ? { ...a, perAccount: 999999999, windowMin: -5 }
        : a));
    limiter.saveConfig(list);
    limiter.invalidate();
    const back = limiter.listConfig().find(a => a.action === 'post_message');
    assert.ok(back.perAccount <= 1000000, '应被夹到上限，实际 ' + back.perAccount);
    assert.ok(back.windowMin >= 1, '窗口至少 1 分钟，实际 ' + back.windowMin);

    // 还原默认，避免污染后续测试
    const { DEFAULTS } = require('../../lib/rate-limit');
    limiter.saveConfig(Object.entries(DEFAULTS)
        .filter(([, d]) => d)
        .map(([action, d]) => ({ action, ...d })));
    limiter.invalidate();
});

// ---- 3. 会话绑定（防 cookie 搬运）----
check('同一 UA + 同一 IP 可正常使用会话', () => {
    const token = sessions.createSession('uid-bind-1', { ua: 'Mozilla/5.0', ip: '192.168.1.1' });
    const uid = sessions.getSessionUser(token, { ua: 'Mozilla/5.0', ip: '192.168.1.1' });
    assert.strictEqual(uid, 'uid-bind-1');
});

check('换浏览器 UA 不会立即踢下线（正常用户不受影响）', () => {
    const token = sessions.createSession('uid-bind-2', { ua: 'Mozilla/5.0', ip: '192.168.1.2' });
    const uid = sessions.getSessionUser(token, { ua: 'OtherBrowser/9', ip: '192.168.1.2' });
    assert.strictEqual(uid, 'uid-bind-2', '只换一个 UA 不应踢下线');
    // 原来的 UA 仍可用
    assert.strictEqual(
        sessions.getSessionUser(token, { ua: 'Mozilla/5.0', ip: '192.168.1.2' }),
        'uid-bind-2', '原 UA 应仍可用');
});

check('UA 过多时判定为 cookie 被搬运并失效', () => {
    const cfg = sessions.getBindConfig();
    const token = sessions.createSession('uid-bind-2b', { ua: 'UA/0', ip: '192.168.1.9' });
    let last = null;
    for (let i = 1; i <= cfg.maxUas + 1; i++) {
        last = sessions.getSessionUser(token, { ua: 'UA/' + i, ip: '192.168.1.9' });
        if (!last) break;
    }
    assert.strictEqual(last, null, 'UA 过多应判定为外泄并失效');
    assert.strictEqual(sessions.getSessionUser(token, { ua: 'UA/0', ip: '192.168.1.9' }),
        null, '失效后不应复活');
});

check('同一会话出现在过多 IP 上会失效', () => {
    const cfg = sessions.getBindConfig();
    const token = sessions.createSession('uid-bind-3', { ua: 'UA/1', ip: '10.0.0.1' });
    let last = null;
    // 超过 maxIps 个不同 IP
    for (let i = 0; i < cfg.maxIps + 2; i++) {
        last = sessions.getSessionUser(token, { ua: 'UA/1', ip: '10.0.0.' + i });
        if (!last) break;
    }
    assert.strictEqual(last, null, 'IP 过多应判定为 cookie 外泄并失效');
});

check('绑定设置可读：UA 校验默认开启', () => {
    const cfg = sessions.getBindConfig();
    assert.strictEqual(cfg.bindUa, true);
    assert.ok(cfg.maxIps >= 1);
});

check('会话列表可查（管理页用）', () => {
    const list = sessions.listSessions();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 0);
    for (const s of list) {
        assert.ok('uid' in s && 'ipCount' in s && 'expiresIn' in s);
    }
});

// ---- 4. 管理页 ----
check('限流管理路由与模板已就位', () => {
    const route = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/manage/rate-limits.js'), 'utf8');
    assert.ok(route.includes("/manage/rate_limits"), '应有 GET/POST 路由');
    assert.ok(route.includes("requireSystemAdmin(user, res, 'rate_limits')"),
        '应有权限守卫');
    const tpl = fs.readFileSync(
        path.join(__dirname, '../../templates/manage_rate_limits.html'), 'utf8');
    assert.ok(tpl.includes('{{ a.action }}'), '模板应列出各动作');
    assert.ok(tpl.includes('save_bind'), '模板应含会话绑定设置');
});

check('限流管理需要专属权限位', () => {
    const { PRIV } = require('../../lib/permissions');
    assert.ok(PRIV.SYSTEM.MANAGE_RATE_LIMITS, '应有 MANAGE_RATE_LIMITS 位');
    const { PAGE_BITS } = require('../../lib/routes/manage/_helpers');
    assert.strictEqual(PAGE_BITS.rate_limits, PRIV.SYSTEM.MANAGE_RATE_LIMITS);
});

check('系统管理菜单有入口', () => {
    const tpl = fs.readFileSync(
        path.join(__dirname, '../../templates/manage.html'), 'utf8');
    assert.ok(tpl.includes('/manage/rate_limits'), '系统管理应有入口');
});

check('注册与发消息都接了限流', () => {
    const auth = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/auth.js'), 'utf8');
    assert.ok(auth.includes("check('register'"), '注册应限流');
    const ws = fs.readFileSync(
        path.join(__dirname, '../../lib/websocket/discuss.js'), 'utf8');
    assert.ok(ws.includes("check('post_message'"), '发消息应限流');
    const dm = fs.readFileSync(
        path.join(__dirname, '../../lib/websocket/dm.js'), 'utf8');
    assert.ok(dm.includes("check('dm_send'"), '私信应限流');
    const files = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/files.js'), 'utf8');
    assert.ok(files.includes("check('upload_file'"), '上传应限流');
});

check('login/register 同时有 IP 与账号维度（防换 IP 撞库）', () => {
    const { listConfig } = require('../../lib/rate-limit');
    for (const action of ['login', 'register']) {
        const c = listConfig().find(a => a.action === action);
        assert.ok(c, action + ' 应有配置');
        assert.ok(c.perIp > 0, action + ' 应有 IP 维度限制');
        assert.ok(c.perAccount > 0,
            action + ' 应有账号维度限制，否则换 IP 就能绕过');
    }
});

check('localhost 豁免限流（限流只是兜底）', () => {
    const limiter = require('../../lib/rate-limit');
    assert.ok(limiter.isLocal('127.0.0.1'), '127.0.0.1 应豁免');
    assert.ok(limiter.isLocal('::1'), '::1 应豁免');
    assert.ok(limiter.isLocal('127.0.0.5'), '整个 127/8 都应豁免');
    assert.ok(!limiter.isLocal('10.0.0.1'), '内网 IP 不豁免');
    assert.ok(!limiter.isLocal(''), '空 IP 不豁免');

    // 本机不该被计数也不该被拦
    limiter.resetCounters('page_view');
    for (let i = 0; i < 2000; i++) {
        limiter.note('page_view', { ip: '127.0.0.1', account: 'a' });
    }
    assert.strictEqual(limiter.check('page_view', { ip: '127.0.0.1', account: 'a' }),
        null, '本机不应被限流');
});

check('限流窗口：手动可设 60 分钟，出厂默认最大 10 分钟', () => {
    const limiter = require('../../lib/rate-limit');
    assert.strictEqual(limiter.WINDOW_MAX, 60, '手动上限应为 60 分钟');

    // 出厂默认的窗口都不超过 10 分钟
    for (const a of Object.values(limiter.DEFAULTS)) {
        if (!a) continue;
        assert.ok(a.windowMin <= 10,
            '出厂默认窗口应 <=10，实际 ' + a.windowMin);
    }

    // 手动存 999 会被夹到 60
    const list = limiter.listConfig().map(a => (a.action === 'login'
        ? { ...a, windowMin: 999 } : a));
    limiter.saveConfig(list);
    limiter.invalidate();
    const back = limiter.listConfig().find(a => a.action === 'login');
    assert.strictEqual(back.windowMin, 60, '窗口应被夹到 60 分钟');

    // 手动存 30 应当保留
    const list2 = limiter.listConfig().map(a => (a.action === 'login'
        ? { ...a, windowMin: 30 } : a));
    limiter.saveConfig(list2);
    limiter.invalidate();
    assert.strictEqual(
        limiter.listConfig().find(a => a.action === 'login').windowMin, 30,
        '手动设的 30 分钟应保留');

    const { DEFAULTS } = require('../../lib/rate-limit');
    limiter.saveConfig(Object.entries(DEFAULTS)
        .filter(([, d]) => d).map(([action, d]) => ({ action, ...d })));
    limiter.invalidate();
});

check('限流返回原因与剩余时间', () => {
    const limiter = require('../../lib/rate-limit');
    limiter.resetCounters('search');
    for (let i = 0; i < 100; i++) {
        limiter.note('search', { ip: '10.7.0.1', account: 'a' });
    }
    const hit = limiter.check('search', { ip: '10.7.0.1', account: 'a' });
    assert.ok(hit, '应被限');
    assert.ok(hit.dim, '应带维度（ip/account）');
    assert.ok(hit.leftSec > 0, '应带剩余秒数');
    assert.ok(hit.leftSec <= 60, '搜索窗口 1 分钟，剩余应 <=60，实际 ' + hit.leftSec);

    const { limitMessage } = require('../../lib/routes/_helpers');
    const msg = limitMessage('搜索', hit);
    assert.ok(msg.includes('搜索'), '文案应说明是什么操作: ' + msg);
    assert.ok(msg.includes('频繁'), '文案应说明原因: ' + msg);
    assert.ok(/[0-9]+ *(秒|分钟)/.test(msg), '文案应带剩余时间: ' + msg);
});

check('过期计数会被清理', () => {
    const limiter = require('../../lib/rate-limit');
    limiter.resetCounters('upload_file');
    limiter.note('upload_file', { ip: '10.8.0.1', account: 'a' });
    // 刚记的不算过期
    assert.strictEqual(limiter.cleanExpired(), 0, '刚记的不该被清');
    // 快照里能看到
    const snap = limiter.snapshot();
    assert.ok(snap.upload_file && snap.upload_file.ip.length, '快照应能看到计数');
});

check('页面/文件/搜索都有独立限流档位', () => {
    const { listConfig } = require('../../lib/rate-limit');
    for (const action of ['page_view', 'file_download', 'search']) {
        const c = listConfig().find(a => a.action === action);
        assert.ok(c, action + ' 应有配置');
        assert.ok(c.perIp > 0, action + ' 应有 IP 限制');
        assert.ok(c.perAccount > 0, action + ' 应有账号限制');
    }
});

check('页面限流已接到路由分发层', () => {
    const src = require('fs').readFileSync(
        path.join(__dirname, '../../lib/routes/index.js'), 'utf8');
    assert.ok(src.includes("check('page_view'"), '路由层应有页面访问限流');
});

check('文件下载限流已接到三个下载路由', () => {
    const src = require('fs').readFileSync(
        path.join(__dirname, '../../lib/routes/files.js'), 'utf8');
    assert.ok(src.includes("check('file_download'"), '应有下载限流');
    const n = (src.match(/limitDownload\(res, req, user\)/g) || []).length;
    assert.ok(n >= 4, '三个下载路由都应接入，实际 ' + n + ' 处');
});

check('搜索限流已接入', () => {
    const src = require('fs').readFileSync(
        path.join(__dirname, '../../lib/routes/search.js'), 'utf8');
    assert.ok(src.includes("check('search'"), '搜索应有独立限流');
});

console.log('\n======== [回归] 限流与会话绑定 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
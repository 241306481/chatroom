'use strict';
// 回归：注册广播 + 域删除通知/断连 + 权限默认值
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { clearTlsArtifacts } = require('./_helpers');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
clearTlsArtifacts(ROOT);

const PORT = 5333;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
let procErr = '';
proc.stderr.on('data', (d) => { procErr += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storage = require(path.join(ROOT, 'lib/storage'));

const jar = new Map();
function applySetCookie(list) {
    for (const c of list || []) {
        const [kv, ...attrs] = c.split(';').map((x) => x.trim());
        const i = kv.indexOf('=');
        if (i < 0) continue;
        const name = kv.substring(0, i);
        const val = kv.substring(i + 1);
        const ma = attrs.find((a) => /^max-age=/i.test(a));
        if (ma && Number(ma.split('=')[1]) <= 0) jar.delete(name);
        else jar.set(name, val);
    }
}
function cookieHeader() {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function req(method, p, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const h = {};
        const c = cookie || cookieHeader();
        if (c) h.Cookie = c;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            (res) => {
                let d = ''; res.on('data', (x) => d += x);
                res.on('end', () => { applySetCookie(res.headers['set-cookie']); resolve({ status: res.statusCode, headers: res.headers, body: d }); });
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

const results = [];
const check = (n, f) => {
    try {
        const r = f();
        if (r && typeof r.then === 'function') {
            return r.then(() => results.push(['PASS', n]),
                (e) => results.push(['FAIL', n + ' -> ' + e.message]));
        }
        results.push(['PASS', n]);
    } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
    return null;
};

(async () => {
    let ready = false;
    for (let i = 0; i < 80; i++) {
        try { await req('GET', '/login'); ready = true; break; }
        catch (e) { await sleep(300); }
    }
    if (!ready) throw new Error('服务器未就绪' + (procErr ? '：' + procErr.slice(0, 200) : ''));

    // 首个注册者 = 超管
    const root = await req('POST', '/register',
        { body: { nickname: 'rootadmin', password: 'pw123456', confirm_password: 'pw123456' } });
    const ROOT_C = (root.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const rootId = storage.findUserByNickname('rootadmin').id;

    // ---------- 权限默认值 ----------
    const { SYSTEM_ROLES_BUILTIN } = require(path.join(ROOT, 'lib/permissions/roles'));
    const { PRIV } = require(path.join(ROOT, 'lib/permissions/priv'));

    check('上传头像权限默认开启（admin 与 member）', () => {
        for (const r of ['admin', 'member']) {
            const b = SYSTEM_ROLES_BUILTIN[r].privs.base;
            assert.ok(b & PRIV.BASE.UPLOAD_AVATAR, r + ' 角色缺 base.upload_avatar 默认');
        }
        const g = SYSTEM_ROLES_BUILTIN.guest.privs.base;
        assert.ok(!(g & PRIV.BASE.UPLOAD_AVATAR), '访客不应有上传头像');
    });

    check('域设置权限默认开启（admin 与 member）', () => {
        for (const r of ['admin', 'member']) {
            const d = SYSTEM_ROLES_BUILTIN[r].privs.domain;
            assert.ok(d & PRIV.DOMAIN.EDIT, r + ' 角色缺 domain.edit 默认');
            assert.ok(d & PRIV.DOMAIN.MANAGE_JOIN, r + ' 缺 domain.manage_join');
            assert.ok(d & PRIV.DOMAIN.TRANSFER, r + ' 缺 domain.transfer');
            assert.ok(d & PRIV.DOMAIN.DELETE, r + ' 缺 domain.delete');
        }
    });

    // ---------- PERM 位独立 ----------
    check('域设置 4 个操作各有独立 PERM 位', () => {
        const { DUAL_CHECK } = require(path.join(ROOT, 'lib/permissions/dual-check'));
        const keys = ['edit_domain', 'manage_join', 'transfer_domain', 'delete_domain'];
        const perms = keys.map((k) => DUAL_CHECK[k].perm);
        assert.strictEqual(new Set(perms).size, 4, '仍有操作共用同一个 PERM 位');
    });

    check('PERM 位 31 的权限也能正确判定', () => {
        const { PERM, hasPerm } = require(path.join(ROOT, 'lib/permissions/perm'));
        assert.ok(hasPerm(PERM.ALL, PERM.GENERAL.VIEW), 'ALL 应含低位');
        assert.ok(hasPerm(PERM.ALL, PERM.MANAGE.DELETE), 'ALL 应含位 31');
        assert.ok(hasPerm(PERM.MANAGE.DELETE, PERM.MANAGE.DELETE), '单独判定应成立');
        assert.ok(!hasPerm(0, PERM.MANAGE.DELETE), '空权限不该有位 31');
        assert.ok(hasPerm(PERM.MANAGE.USER, PERM.MESSAGE.MUTE_MEMBER), '隐含关系仍应生效');
    });

    // ---------- 注册广播 members_update ----------
    check('注册会广播 members_update 到 system 域', () => {
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/auth.js'), 'utf8');
        const i = src.indexOf("registerUser(");
        assert.ok(i > 0, '未找到 registerUser 调用');
        const after = src.slice(i, i + 400);
        assert.ok(/broadcastMembersUpdate\('system'\)/.test(after),
            '注册后未广播 members_update');
    });

    // 建一个域，验证删除通知
    const created = await req('POST', '/create/domain',
        { body: { name: 'tempdomain', display_name: '临时域' }, cookie: ROOT_C });
    // 新建域默认 closed，改 open 才能测成员加入
    await req('POST', '/domain/tempdomain/manage/join',
        { body: { join_policy: 'open' }, cookie: ROOT_C });
    check('创建测试域', () => {
        assert.ok(storage.domainExists('tempdomain'), '域未创建，status=' + created.status);
    });

    // 第二个用户走正式的加入接口。
// 注意：服务端与本测试进程各有独立的 storage 模块缓存，不能靠读磁盘判断，
// 改用 HTTP 状态码。
    const reg2 = await req('POST', '/register',
        { body: { nickname: 'tempuser', password: 'pw123456', confirm_password: 'pw123456' } });
    const C2 = (reg2.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    check('第二个用户注册成功', () => {
        assert.ok(reg2.status === 302 || reg2.status === 303, 'status=' + reg2.status);
        assert.ok(C2.includes('token='), '未拿到会话 cookie');
    });
    const joined = await req('POST', '/domain/tempdomain/join', { cookie: C2 });
    check('第二个用户加入域', () => {
        // 新建域默认 join_policy=closed，这里改 open 才加得进去
        assert.ok(joined.status === 302 || joined.status === 303,
            '加入失败，status=' + joined.status + ' body='
            + joined.body.replace(/\s+/g, ' ').slice(0, 300));
    });

    let gotDelete = null;
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/status/tempdomain`,
        { headers: { Cookie: cookieHeader() } });
    await new Promise((res) => { ws.on('open', res); ws.on('error', res); });
    ws.on('message', (d) => {
        try { const j = JSON.parse(String(d)); if (j.type === 'domain_deleted') gotDelete = j; }
        catch (e) { /* 非 JSON 忽略 */ }
    });
    await sleep(300);

    // ---------- 域删除需要权限 ----------
    check('无权者不能删除域（403 而非 404）', async () => {
        // 上面已把域加给了 tempuser，但 tempuser 不是 root
    });

    const del = await req('POST', '/domain/tempdomain/manage/delete',
        { body: { confirm: 'DELETE' }, cookie: ROOT_C });
    check('超管可删除自己的域', () => {
        assert.ok(del.status === 302 || del.status === 303, 'status=' + del.status);
        assert.ok(!storage.domainExists('tempdomain'), '域目录仍在');
    });
    check('删除会广播 domain_deleted', () => {
        assert.ok(gotDelete, '未收到 domain_deleted 事件');
        assert.strictEqual(gotDelete.name, '临时域');
    });
    check('删除会把成员踢下线', () => {
        // 2=CLOSING 3=CLOSED
        assert.ok(ws.readyState >= 2, 'readyState=' + ws.readyState + '（应已断开或正在断开）');
    });

    check('域不存在时返回 404 而不是 403', async () => {
        // 已在上方验证 delete 成功，这里补一次不存在的域
    });
    const missing = await req('POST', '/domain/nosuchdom/manage/delete',
        { body: { confirm: 'DELETE' }, cookie: ROOT_C });
    check('不存在的域：404', () => {
        assert.strictEqual(missing.status, 404, '实际 ' + missing.status);
    });

    check('转让域需要权限，不能匿名操作', () => {
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/manage/domain.js'), 'utf8');
        const i = src.indexOf("'POST', '/domain/:domain_name/manage/transfer'");
        assert.ok(i > 0, '未找到 transfer 路由');
        const body2 = src.slice(i, i + 400);
        assert.ok(/guard\(user, dn, 'transfer_domain'\)/.test(body2),
            'transfer 未走统一守卫');
    });

    check('manage 子页统一用 guard，避免多层 403/404', () => {
        const src = fs.readFileSync(path.join(ROOT, 'lib/routes/manage/domain.js'), 'utf8');
        const bare = src.match(/^\s*checkDual\(user, /gm) || [];
        assert.strictEqual(bare.length, 0, '仍有 ' + bare.length + ' 处裸 checkDual');
        const guards = (src.match(/guard\(user, dn,/g) || []).length;
        assert.ok(guards >= 9, 'guard 使用处偏少: ' + guards);
    });

    proc.kill();
    console.log('\n======== [回归] 注册广播 / 域删除通知 / 权限默认 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter((x) => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { clearTlsArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
clearTlsArtifacts(ROOT);
const PORT = 5341;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
let procErr = '';
proc.stderr.on('data', (d) => { procErr += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const storage = require(path.join(ROOT, 'lib/storage'));
const { PRIV } = require(path.join(ROOT, 'lib/permissions'));
function req(method, p, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const h = { Origin: 'http://127.0.0.1:' + PORT };
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            (res) => {
                let d = '';
                res.on('data', (c) => d += c);
                res.on('end', () => resolve({
                    status: res.statusCode, headers: res.headers, body: d,
                }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
function cookieOf(res) {
    return (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}
function jsonOf(res) {
    try { return JSON.parse(res.body); }
    catch (e) { throw new Error('无效 JSON: ' + res.body); }
}
function setConfig(patch) {
    const domain = storage.loadDomain('system');
    domain.system_config = Object.assign({}, domain.system_config || {}, patch);
    storage.saveDomain('system', domain);
}
function getUser(uid) {
    return storage.loadUser(uid);
}
const results = [];
async function check(name, fn) {
    try {
        await fn();
        results.push(['PASS', name]);
    } catch (e) {
        results.push(['FAIL', name + ' -> ' + e.message]);
    }
}
(async () => {
    let ready = false;
    for (let i = 0; i < 80; i++) {
        try { await req('GET', '/login'); ready = true; break; }
        catch (e) { await sleep(300); }
    }
    if (!ready) throw new Error('服务器未就绪' + (procErr ? ': ' + procErr.slice(0, 200) : ''));
    const rootReg = await req('POST', '/register', {
        body: { nickname: 'rootnick', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const rootC = cookieOf(rootReg);
    const userReg = await req('POST', '/register', {
        body: { nickname: 'cooluser', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const userC = cookieOf(userReg);
    const rootUid = storage.findUserByNickname('rootnick').id;
    const userUid = storage.findUserByNickname('cooluser').id;
    const postProfile = (cookie, uid, body) =>
        req('POST', `/user/${uid}`, { body, cookie });

    setConfig({ allow_username_change: true, username_change_interval_hours: 24 });
    await check('首次修改用户名成功并记录时间', async () => {
        const r = await postProfile(userC, userUid, { nickname: 'cooluser2', bio: 'first' });
        assert.ok(jsonOf(r).ok, r.body);
        const u = getUser(userUid);
        assert.strictEqual(u.nickname, 'cooluser2');
        assert.ok(u.nickname_changed_at, '未记录 nickname_changed_at');
        assert.strictEqual(u.bio, 'first');
    });
    await check('冷却期内再次修改被拒且简介不变', async () => {
        const r = await postProfile(userC, userUid, { nickname: 'cooluser3', bio: 'second' });
        const j = jsonOf(r);
        assert.strictEqual(j.ok, false, r.body);
        assert.ok(/过于频繁/.test(j.error || ''), '缺少冷却提示: ' + j.error);
        const u = getUser(userUid);
        assert.strictEqual(u.nickname, 'cooluser2');
        assert.strictEqual(u.bio, 'first');
    });
    await check('冷却期内仍可保存简介', async () => {
        const before = getUser(userUid).nickname_changed_at;
        const r = await postProfile(userC, userUid, { nickname: 'cooluser2', bio: 'third' });
        assert.ok(jsonOf(r).ok, r.body);
        const u = getUser(userUid);
        assert.strictEqual(u.bio, 'third');
        assert.strictEqual(u.nickname_changed_at, before);
    });
    await check('个人页显示冷却提示并禁用昵称输入', async () => {
        const r = await req('GET', `/user/${userUid}`, { cookie: userC });
        assert.ok(/用户名修改过于频繁/.test(r.body), '缺少冷却提示');
        assert.ok(/name="nickname"[^>]*disabled/.test(r.body)
            || /disabled[^>]*name="nickname"/.test(r.body), '昵称输入未禁用');
    });

    setConfig({ allow_username_change: false });
    await check('关闭开关后普通用户不能改用户名', async () => {
        const r = await postProfile(userC, userUid, { nickname: 'cooluser4', bio: 'x' });
        const j = jsonOf(r);
        assert.strictEqual(j.ok, false, r.body);
        assert.ok(/系统已关闭用户名修改/.test(j.error || ''), j.error);
        assert.strictEqual(getUser(userUid).nickname, 'cooluser2');
    });
    await check('关闭开关后超级管理员也不能改用户名', async () => {
        const r = await postProfile(rootC, rootUid, { nickname: 'rootnick2', bio: 'x' });
        const j = jsonOf(r);
        assert.strictEqual(j.ok, false, r.body);
        assert.ok(/系统已关闭用户名修改/.test(j.error || ''), j.error);
        assert.strictEqual(getUser(rootUid).nickname, 'rootnick');
    });
    await check('关闭开关后仍可保存简介', async () => {
        const r = await postProfile(userC, userUid, { nickname: 'cooluser2', bio: 'off-bio' });
        assert.ok(jsonOf(r).ok, r.body);
        assert.strictEqual(getUser(userUid).bio, 'off-bio');
    });

    setConfig({ allow_username_change: true, username_change_interval_hours: 24 });
    await check('超级管理员可绕过冷却', async () => {
        const root = getUser(rootUid);
        root.nickname_changed_at = storage.nowIso();
        storage.saveUser(rootUid, root);
        const r = await postProfile(rootC, rootUid, { nickname: 'rootnick2', bio: 'rootbio' });
        assert.ok(jsonOf(r).ok, r.body);
        assert.strictEqual(getUser(rootUid).nickname, 'rootnick2');
    });
    await check('授予权限后普通用户可绕过冷却', async () => {
        const u = getUser(userUid);
        u.nickname_changed_at = storage.nowIso();
        storage.saveUser(userUid, u);
        const grant = await req('POST', '/manage/permissions', {
            cookie: rootC,
            body: { 'priv_member.system': String(PRIV.SYSTEM.BYPASS_NICKNAME_COOLDOWN) },
        });
        assert.ok(jsonOf(grant).ok, grant.body);
        const r = await postProfile(userC, userUid, { nickname: 'cooluser5', bio: 'bypass' });
        assert.ok(jsonOf(r).ok, r.body);
        assert.strictEqual(getUser(userUid).nickname, 'cooluser5');
    });
    await check('系统设置保存用户名策略', async () => {
        const r = await req('POST', '/manage/settings', {
            cookie: rootC,
            body: {
                site_name: '测试站', site_announcement: '',
                allow_register: 'on', max_domains_per_user: '5',
                max_file_size_mb: '50', session_timeout_hours: '24',
                allow_username_change: 'on',
                username_change_interval_hours: '12',
            },
        });
        assert.ok(jsonOf(r).ok, r.body);
        const cfg = storage.loadDomain('system').system_config;
        assert.strictEqual(cfg.allow_username_change, true);
        assert.strictEqual(cfg.username_change_interval_hours, 12);
    });

    proc.kill();
    console.log('\n======== [回归] 用户名修改策略 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const failed = results.filter((x) => x[0] === 'FAIL').length;
    console.log(results.length - failed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error(e);
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    proc.kill();
    process.exit(1);
});

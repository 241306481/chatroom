'use strict';
// 端到端：资料表单带文件提交后，头像与简介都正确
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });

const PORT = 5311;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
proc.stderr.on('data', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const storage = require(path.join(ROOT, 'lib/storage'));
const avatarMod = require(path.join(ROOT, 'lib/storage/avatar'));
const avatarView = require(path.join(ROOT, 'lib/avatar-view'));

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0xFF, 0xD9]);

function req(method, p, { body, cookie, ct } = {}) {
    return new Promise((resolve, reject) => {
        const h = {};
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (body) {
            payload = Buffer.isBuffer(body) ? body : Buffer.from(new URLSearchParams(body).toString());
            if (ct) h['Content-Type'] = ct;
            else if (!Buffer.isBuffer(body)) h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            (res) => {
                let d = ''; res.on('data', (c) => d += c);
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

function multipart(fields, file) {
    const b = '----ChatTest' + Date.now();
    const parts = [];
    for (const [k, v] of Object.entries(fields)) {
        parts.push(Buffer.from(
            `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'));
    }
    if (file) {
        parts.push(Buffer.from(
            `--${b}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\n`
            + `Content-Type: ${file.mime}\r\n\r\n`, 'utf8'));
        parts.push(file.data);
        parts.push(Buffer.from('\r\n', 'utf8'));
    }
    parts.push(Buffer.from(`--${b}--\r\n`, 'utf8'));
    return { body: Buffer.concat(parts), ct: 'multipart/form-data; boundary=' + b };
}

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

(async () => {
    for (let i = 0; i < 60; i++) { try { await req('GET', '/login'); break; } catch (e) { await sleep(300); } }

    const reg = await req('POST', '/register', {
        body: { nickname: 'avatester', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const C = (reg.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const uid = storage.findUserByNickname('avatester').id;

    // 先设一个非空简介，用来验证 multipart 不会把它清空
    await req('POST', `/user/${uid}`, { body: { nickname: 'avatester', bio: '我的原始简介' }, cookie: C });

    check('首字资料提交：简介与昵称正常', () => {
        const u = storage.loadUser(uid);
        assert.strictEqual(u.bio, '我的原始简介', '简介丢了');
        assert.strictEqual(u.nickname, 'avatester');
    });

    // 上传图片（真实请求）
    const mp1 = multipart({ nickname: 'avatester', bio: '换了简介', avatar_remove: '0' },
        { field: 'avatar_file', name: 'a.png', mime: 'image/png', data: PNG });
    const r1 = await req('POST', `/user/${uid}`, { body: mp1.body, cookie: C, ct: mp1.ct });
    check('上传图片后 avatar_ext 落库', () => {
        assert.ok(r1.status === 302 || r1.status === 303, '未重定向，status=' + r1.status);
        const u = storage.loadUser(uid);
        assert.strictEqual(u.avatar_ext, 'png', 'avatar_ext 未写入，实际: ' + JSON.stringify(u.avatar_ext));
    });
    check('上传后磁盘文件存在', () => {
        assert.ok(fs.existsSync(avatarMod.avatarPath(uid, 'png')), '文件不存在');
    });
    check('上传后 avatarSrc 能出 URL', () => {
        const u = storage.loadUser(uid);
        assert.strictEqual(avatarView.avatarSrc(u), '/avatar/' + uid + '/png');
    });
    check('上传时昵称与简介一并保存（multipart 字段没丢）', () => {
        const u = storage.loadUser(uid);
        assert.strictEqual(u.bio, '换了简介', '简介被清空或没提交，实际: ' + JSON.stringify(u.bio));
        assert.strictEqual(u.nickname, 'avatester');
    });

    // 换格式：应清掉旧的 png
    const mp2 = multipart({ nickname: 'avatester', bio: '换了简介', avatar_remove: '0' },
        { field: 'avatar_file', name: 'b.jpg', mime: 'image/jpeg', data: JPG });
    await req('POST', `/user/${uid}`, { body: mp2.body, cookie: C, ct: mp2.ct });
    check('换格式：字段与文件同步更新，旧文件已清', () => {
        const u = storage.loadUser(uid);
        assert.strictEqual(u.avatar_ext, 'jpg', '字段未更新: ' + u.avatar_ext);
        assert.ok(!fs.existsSync(avatarMod.avatarPath(uid, 'png')), '旧 png 未删除');
        assert.ok(fs.existsSync(avatarMod.avatarPath(uid, 'jpg')), '新 jpg 不存在');
    });
    check('换格式：简介未被清空', () => {
        assert.strictEqual(storage.loadUser(uid).bio, '换了简介');
    });

    // 删除
    const mp3 = multipart({ nickname: 'avatester', bio: '换了简介', avatar_remove: '1' }, null);
    await req('POST', `/user/${uid}`, { body: mp3.body, cookie: C, ct: mp3.ct });
    check('删除：字段与文件都清掉', () => {
        const u = storage.loadUser(uid);
        assert.ok(!u.avatar_ext, 'avatar_ext 未清除');
        assert.ok(!fs.existsSync(avatarMod.avatarPath(uid, 'jpg')), '文件未删除');
        assert.strictEqual(u.bio, '换了简介', '删除时简介不该被动');
    });

    // 普通 urlencoded 提交（无 JS 场景）不该动头像
    avatarMod.save(uid, PNG);
    const u4 = storage.loadUser(uid); u4.avatar_ext = 'png'; storage.saveUser(uid, u4);
    await req('POST', `/user/${uid}`, { body: { nickname: 'avatester', bio: '普通提交' }, cookie: C });
    check('普通表单提交不动头像', () => {
        const u = storage.loadUser(uid);
        assert.strictEqual(u.avatar_ext, 'png', '头像被误改');
        assert.ok(fs.existsSync(avatarMod.avatarPath(uid, 'png')));
        assert.strictEqual(u.bio, '普通提交');
    });

    // 页面渲染能出图
    const page = await req('GET', `/user/${uid}`, { cookie: C });
    check('个人页渲染出图片头像', () => {
        assert.ok(page.body.includes('/avatar/' + uid + '/png'),
            '页面未出图片 URL');
    });

    proc.kill();
    console.log('\n======== [回归] 资料表单带图提交 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter((x) => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); proc.kill(); process.exit(1); });
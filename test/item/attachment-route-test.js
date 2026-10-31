'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const PORT = 5199;
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const { sleep, waitForServer, clearTlsArtifacts } = require('./_helpers');
clearTlsArtifacts(ROOT);
const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) },
});
proc.stdout.on('data', () => {});
const srvErr = [];
proc.stderr.on('data', d => srvErr.push(String(d)));
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
function req(method, p, { body, cookie, headers } = {}) {
    return new Promise((resolve, reject) => {
        const h = Object.assign({}, headers);
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (body && !Buffer.isBuffer(body)) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        if (payload) h['Content-Length'] = payload.length;
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
const cookieOf = r => (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
function multipart(file) {
    const b = '----AttachTest' + Date.now();
    const head = Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n`
        + `Content-Type: ${file.mime}\r\n\r\n`, 'utf8');
    const tail = Buffer.from('\r\n' + `--${b}--\r\n`, 'utf8');
    return {
        body: Buffer.concat([head, file.data, tail]),
        ct: 'multipart/form-data; boundary=' + b,
    };
}
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');
(async () => {
    await waitForServer(PORT);
    const regA = await req('POST', '/register', {
        body: { nickname: 'attA', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const regB = await req('POST', '/register', {
        body: { nickname: 'attB', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const regC = await req('POST', '/register', {
        body: { nickname: 'attC', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const A = cookieOf(regA);
    const B = cookieOf(regB);
    const C = cookieOf(regC);
    const storage = require('../../lib/storage');
    const uidA = storage.findUserByNickname('attA').id;
    const uidB = storage.findUserByNickname('attB').id;
    const up = multipart({ name: 'dm.png', mime: 'image/png', data: PNG });
    const uploaded = await req('POST', `/messages/${uidB}/files/upload`, {
        cookie: A, body: up.body, headers: { 'Content-Type': up.ct },
    });
    let file = null;
    try { file = JSON.parse(uploaded.body.toString('utf8')).file; } catch (e) {}
    check('私信附件上传成功', () => {
        assert.strictEqual(uploaded.status, 200);
        assert.ok(file && file.id, '响应缺少 file.id');
        assert.ok(storage.getDMAttachment(uidA, uidB, file.id), '元数据未写入');
    });
    const url = `/messages/file/${uidA}/${uidB}/${file.id}`;
    storage.appendDM(uidA, uidB, `![x](${url})`);
    const seenA = await req('GET', url, { cookie: A });
    check('发送者可内联查看私信附件', () => {
        assert.strictEqual(seenA.status, 200);
        assert.ok(Buffer.compare(seenA.body, PNG) === 0);
        assert.ok(/^inline/.test(seenA.headers['content-disposition'] || ''));
    });
    const seenB = await req('GET', url, { cookie: B });
    check('接收者可内联查看私信附件', () => {
        assert.strictEqual(seenB.status, 200);
        assert.ok(Buffer.compare(seenB.body, PNG) === 0);
    });
    const seenC = await req('GET', url, { cookie: C });
    check('非会话成员不能查看私信附件', () => {
        assert.strictEqual(seenC.status, 403);
    });
    const down = await req('GET', url + '/download', { cookie: B });
    check('私信附件下载接口强制附件', () => {
        assert.strictEqual(down.status, 200);
        assert.ok(/^attachment/.test(down.headers['content-disposition'] || ''));
    });
    const upSys = await req('POST', `/messages/${storage.SYSTEM_UID}/files/upload`, {
        cookie: A, body: up.body, headers: { 'Content-Type': up.ct },
    });
    check('不能向系统账号上传私信附件', () => {
        assert.notStrictEqual(upSys.status, 200);
    });
    const upDisc = multipart({ name: 'note.txt', mime: 'text/plain', data: Buffer.from('ok') });
    const disc = await req('POST', '/domain/system/discuss/general/files/upload', {
        cookie: A, body: upDisc.body, headers: { 'Content-Type': upDisc.ct },
    });
    let discFile = null;
    try { discFile = JSON.parse(disc.body.toString('utf8')).file; } catch (e) {}
    check('讨论附件上传成功', () => {
        assert.strictEqual(disc.status, 200);
        assert.ok(discFile && discFile.id, '响应缺少 file.id');
        assert.ok(storage.getDiscussAttachment('system', 'general', discFile.id));
    });
    const discUrl = `/domain/system/discuss/general/file/${discFile.id}`;
    const discSeen = await req('GET', discUrl, { cookie: B });
    check('有讨论查看权限的成员可读取附件', () => {
        assert.strictEqual(discSeen.status, 200);
        assert.strictEqual(discSeen.body.toString('utf8'), 'ok');
    });
    try { proc.kill('SIGINT'); } catch (e) {}
    await sleep(800);
    try { proc.kill('SIGKILL'); } catch (e) {}
    for (const [st, n] of results) console.log(st + '  ' + n);
    const failed = results.filter(r => r[0] === 'FAIL').length;
    console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
    if (failed) {
        if (srvErr.length) console.error('\n[server stderr]\n' + srvErr.join('').slice(0, 2000));
        process.exit(1);
    }
    process.exit(0);
})().catch(e => {
    console.error('FATAL: ' + (e && e.stack || e));
    try { proc.kill('SIGKILL'); } catch (x) {}
    process.exit(1);
});

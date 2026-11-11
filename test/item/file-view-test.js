'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const PORT = 5391;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
proc.stderr.on('data', () => {});
const { waitForServer, clearTestArtifacts } = require('./_helpers');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
function req(method, p, { body, cookie, ct, headers } = {}) {
    return new Promise((resolve, reject) => {
        const h = { Origin: 'http://127.0.0.1:' + PORT, ...(headers || {}) };
        if (cookie) h.Cookie = cookie;
        if (body) {
            h['Content-Type'] = ct || 'application/x-www-form-urlencoded';
            h['Content-Length'] = body.length;
        }
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
        if (body) r.write(body);
        r.end();
    });
}
const cookieOf = r => (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
function multipart(name, mime, text) {
    const b = '----FileView' + Date.now();
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    return {
        ct: 'multipart/form-data; boundary=' + b,
        body: Buffer.concat([
            Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n`
                + `Content-Type: ${mime}\r\n\r\n`, 'utf8'),
            data,
            Buffer.from(`\r\n--${b}--\r\n`, 'utf8'),
        ]),
    };
}
async function upload(cookie, name, mime, text) {
    const form = multipart(name, mime, text);
    const r = await req('POST', '/myfile/upload', { body: form.body, ct: form.ct, cookie });
    return { r, data: JSON.parse(r.body.toString('utf8')) };
}
(async () => {
    await waitForServer(PORT);
    const reg = await req('POST', '/register', {
        body: Buffer.from(new URLSearchParams({
            nickname: 'fileview', password: 'pw123456', confirm_password: 'pw123456',
        }).toString()),
    });
    const C = cookieOf(reg);
    const cpp = await upload(C, '测试.cpp', 'text/x-c++src', 'int main() { return 0; }');
    check('上传后中文文件名保持完整', () => {
        assert.strictEqual(cpp.r.status, 200, cpp.r.body.toString('utf8'));
        assert.strictEqual(cpp.data.ok, true, cpp.r.body.toString('utf8'));
        assert.strictEqual(cpp.data.file.filename, '测试.cpp');
    });
    const cppView = await req('GET', '/myfile/' + cpp.data.file.id, { cookie: C });
    check('cpp 文件可直接查看', () => {
        assert.strictEqual(cppView.status, 200);
        assert.match(cppView.headers['content-type'] || '', /^text\/plain/);
        assert.match(cppView.headers['content-disposition'] || '', /^inline/);
        assert.strictEqual(cppView.body.toString('utf8'), 'int main() { return 0; }');
    });
    const range = await req('GET', '/myfile/' + cpp.data.file.id,
        { cookie: C, headers: { Range: 'bytes=0-3' } });
    check('文件支持字节 Range 响应', () => {
        assert.strictEqual(range.status, 206);
        assert.strictEqual(range.headers['accept-ranges'], 'bytes');
        assert.strictEqual(range.headers['content-range'], 'bytes 0-3/24');
        assert.strictEqual(range.body.toString('utf8'), 'int ');
    });
    const suffix = await req('GET', '/myfile/' + cpp.data.file.id,
        { cookie: C, headers: { Range: 'bytes=-6' } });
    check('文件支持后缀 Range 响应', () => {
        assert.strictEqual(suffix.status, 206);
        assert.strictEqual(suffix.body.toString('utf8'), 'n 0; }');
    });
    const badRange = await req('GET', '/myfile/' + cpp.data.file.id,
        { cookie: C, headers: { Range: 'bytes=999-1000' } });
    check('不可满足的 Range 返回 416', () => {
        assert.strictEqual(badRange.status, 416);
        assert.strictEqual(badRange.headers['content-range'], 'bytes */24');
    });
    const exe = await upload(C, '程序说明.exe', 'application/x-msdownload', '这是文本内容');
    check('上传后 .exe 文本文件名保持完整', () => {
        assert.strictEqual(exe.r.status, 200, exe.r.body.toString('utf8'));
        assert.strictEqual(exe.data.ok, true, exe.r.body.toString('utf8'));
        assert.strictEqual(exe.data.file.filename, '程序说明.exe');
    });
    const exeView = await req('GET', '/myfile/' + exe.data.file.id, { cookie: C });
    check('exe 结尾的文本可直接查看', () => {
        assert.strictEqual(exeView.status, 200);
        assert.match(exeView.headers['content-type'] || '', /^text\/plain/);
        assert.match(exeView.headers['content-disposition'] || '', /^inline/);
        assert.strictEqual(exeView.body.toString('utf8'), '这是文本内容');
    });
    const png = await sharp({
        create: {
            width: 800, height: 600, channels: 3,
            background: { r: 12, g: 180, b: 90 },
        },
    }).png().toBuffer();
    const img = await upload(C, 'thumb-image.png', 'image/png', png);
    const thumb = await req('GET', '/myfile/' + img.data.file.id + '?thumb=1', { cookie: C });
    check('图片缩略图按需生成并返回 WebP', () => {
        assert.strictEqual(img.r.status, 200, img.r.body.toString('utf8'));
        assert.strictEqual(thumb.status, 200);
        assert.match(thumb.headers['content-type'] || '', /^image\/webp/);
        assert.strictEqual(thumb.body.subarray(0, 4).toString('latin1'), 'RIFF');
        assert.strictEqual(thumb.body.subarray(8, 12).toString('latin1'), 'WEBP');
    });
    function uploadedPath(id) {
        const users = path.join(DATA, 'users');
        for (const uid of fs.readdirSync(users)) {
            const p = path.join(users, uid, 'files', id);
            if (fs.existsSync(p)) return p;
        }
        return '';
    }
    const imgPath = uploadedPath(img.data.file.id);
    const thumbPath = imgPath + '.thumb.webp';
    check('缩略图文件与缓存已写入', () => {
        assert.ok(imgPath, '找不到上传文件');
        assert.ok(fs.existsSync(thumbPath), '缩略图文件应存在');
    });
    const delImg = await req('POST', '/myfile/' + img.data.file.id + '/delete', {
        cookie: C,
        ct: 'application/x-www-form-urlencoded;charset=UTF-8',
        body: Buffer.alloc(0),
    });
    check('删除图片时同时清理缩略图', () => {
        assert.strictEqual(delImg.status, 200, delImg.body.toString('utf8'));
        assert.ok(!fs.existsSync(imgPath), '原文件应删除');
        assert.ok(!fs.existsSync(thumbPath), '缩略图应删除');
    });
    const down = await req('GET', '/myfile/' + cpp.data.file.id + '/download', { cookie: C });
    check('显式下载仍强制附件', () => {
        assert.strictEqual(down.status, 200);
        assert.match(down.headers['content-disposition'] || '', /^attachment/);
    });
    const del = await req('POST', '/myfile/' + cpp.data.file.id + '/delete', {
        cookie: C,
        ct: 'application/x-www-form-urlencoded;charset=UTF-8',
        body: Buffer.alloc(0),
    });
    check('删除文件返回列表', () => {
        assert.strictEqual(del.status, 200, del.body.toString('utf8'));
        const data = JSON.parse(del.body.toString('utf8'));
        assert.strictEqual(data.ok, true);
        assert.strictEqual(data.redirect, '/myfile');
    });
    const list = await req('GET', '/myfile', { cookie: C });
    check('删除后文件列表可访问', () => {
        assert.strictEqual(list.status, 200);
        assert.ok(!list.body.toString('utf8').includes('测试.cpp'));
    });
    proc.kill();
    await new Promise(r => setTimeout(r, 300));
    clearTestArtifacts(ROOT);
    console.log('\n======== [回归] 文件名与文本查看 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})().catch(async e => {
    console.error('SUITE ERROR', e && e.message);
    try { proc.kill(); } catch (e2) {}
    clearTestArtifacts(ROOT);
    process.exit(2);
});

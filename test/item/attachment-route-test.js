'use strict';
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
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
        const h = Object.assign({ Origin: 'http://127.0.0.1:' + PORT }, headers);
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
    if (file) {
        const page = await req('GET', `/messages?target=${uidB}`, { cookie: A });
        const html = page.body.toString('utf8');
        check('私信页右侧显示当前会话文件栏', () => {
            assert.strictEqual(page.status, 200);
            assert.ok(html.includes('dm-layout dm-with-files'), '缺少三栏布局');
            assert.ok(html.includes('dm-file-sidebar'), '缺少私信文件栏');
            assert.ok(html.includes('dm.png'), '文件栏缺少上传文件名');
            assert.ok(html.includes(url), '文件栏链接错误');
            assert.ok(html.includes(url + '/download'), '文件栏缺少下载链接');
        });
    }
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
    if (discFile) {
        const page = await req('GET', '/domain/system/discuss/general', { cookie: B });
        const html = page.body.toString('utf8');
        check('讨论文件栏位于置顶消息与成员之间', () => {
            assert.strictEqual(page.status, 200);
            const pin = html.indexOf('pinned-panel');
            const files = html.indexOf('discuss-file-sidebar');
            const members = html.indexOf('members-panel');
            assert.ok(pin >= 0 && files > pin && members > files, '文件栏顺序或位置错误');
            assert.ok(html.includes('note.txt'), '文件栏缺少上传文件名');
            assert.ok(html.includes(discUrl), '文件栏链接错误');
            assert.ok(html.includes(discUrl + '/download'), '文件栏缺少下载链接');
        });
        check('讨论与私信文件侧栏复用同一模板', () => {
            const read = p => fs.readFileSync(path.join(ROOT, 'templates', p), 'utf8');
            const discussTpl = read('discuss.html');
            const messagesTpl = read('messages.html');
            const macro = read('_file_sidebar.html');
            assert.ok(discussTpl.includes('import file_sidebar'));
            assert.ok(messagesTpl.includes('import file_sidebar'));
            assert.ok(!discussTpl.includes('class="file-sidebar-item"'));
            assert.ok(!messagesTpl.includes('class="file-sidebar-item"'));
            assert.ok(macro.includes('data-file-panel'));
            assert.ok(macro.includes('data-file-list'));
            assert.ok(macro.includes('data-file-count'));
        });
        const allPage = await req('GET', '/domain/system/discuss/general/files', { cookie: B });
        check('讨论文件专页列出全部文件', () => {
            assert.strictEqual(allPage.status, 200);
            const html = allPage.body.toString('utf8');
            assert.ok(html.includes('讨论文件'), '缺少页面标题');
            assert.ok(html.includes('note.txt'), '专页缺少文件名');
            assert.ok(html.includes(discUrl), '专页缺少查看链接');
            assert.ok(html.includes(discUrl + '/download'), '专页缺少下载链接');
        });
        const dmPage = await req('GET', `/messages/${uidB}/files`, { cookie: A });
        check('私信文件专页列出当前会话文件', () => {
            assert.strictEqual(dmPage.status, 200);
            const html = dmPage.body.toString('utf8');
            assert.ok(html.includes('私信文件'), '缺少页面标题');
            assert.ok(html.includes('dm.png'), '专页缺少文件名');
            assert.ok(html.includes(url), '专页缺少查看链接');
        });
        const ws = new WebSocket(
            `ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
            { headers: { Cookie: A, Origin: `http://127.0.0.1:${PORT}` } });
        const wsOpen = await new Promise(resolve => {
            const t = setTimeout(() => resolve(false), 4000);
            ws.once('open', () => { clearTimeout(t); resolve(true); });
            ws.once('error', () => { clearTimeout(t); resolve(false); });
        });
        let wsEvent = null;
        if (wsOpen) {
            const got = new Promise(resolve => {
                const t = setTimeout(() => resolve(null), 4000);
                ws.on('message', raw => {
                    let data;
                    try { data = JSON.parse(raw.toString()); } catch (e) { return; }
                    if (data.type !== 'discuss_file_added') return;
                    clearTimeout(t);
                    resolve(data);
                });
            });
            const wsUp = multipart({
                name: 'ws-note.txt', mime: 'text/plain', data: Buffer.from('ws'),
            });
            const upRes = await req('POST', '/domain/system/discuss/general/files/upload', {
                cookie: A, body: wsUp.body, headers: { 'Content-Type': wsUp.ct },
            });
            assert.strictEqual(upRes.status, 200);
            wsEvent = await got;
        }
        check('讨论附件上传广播 WS 文件事件', () => {
            assert.ok(wsOpen, 'WS 未建立');
            assert.ok(wsEvent && wsEvent.file, '未收到文件事件');
            assert.strictEqual(wsEvent.file.filename, 'ws-note.txt');
            assert.match(wsEvent.file.url, /\/discuss\/general\/file\//);
            assert.ok(wsEvent.file.download_url.endsWith('/download'));
        });
        ws.close();
    }
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

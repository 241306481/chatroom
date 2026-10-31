const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const PORT = 5198;
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
    const b = '----ChatTest' + Date.now();
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
        body: { nickname: 'dmpicA', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const regB = await req('POST', '/register', {
        body: { nickname: 'dmpicB', password: 'pw123456', confirm_password: 'pw123456' },
    });
    const A = cookieOf(regA);
    const B = cookieOf(regB);
    const storage = require('../../lib/storage');
    const uidA = storage.findUserByNickname('dmpicA').id;
    check('私信编辑器声明图片公开', () => {
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/messages.html'), 'utf8');
        assert.ok(/imageVisibility:\s*'public'/.test(tpl), 'messages.html 未声明 imageVisibility');
    });
    check('编辑器把 imageVisibility 输出到 data 属性', () => {
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/context_edit.html'), 'utf8');
        assert.ok(/data-image-visibility=/.test(tpl), 'context_edit.html 缺少 data-image-visibility');
    });
    check('工具栏把 visibility 传给上传组件', () => {
        const js = fs.readFileSync(path.join(ROOT, 'static/js/editor/toolbar.js'), 'utf8');
        assert.ok(/dataset\.imageVisibility/.test(js), 'toolbar.js 未读取 imageVisibility');
        assert.ok(/pickAndUpload\(ta, refresh,\s*\{\s*(?:kind:[^,]+,\s*)?visibility/.test(js),
            'toolbar.js 未把 visibility 传给 pickAndUpload');
    });
    check('上传组件会带上 visibility=public', () => {
        const js = fs.readFileSync(path.join(ROOT, 'static/js/editor/upload-inline.js'), 'utf8');
        assert.ok(/\?visibility=public/.test(js), 'upload-inline.js 未拼 visibility 参数');
        assert.ok(/_upload\(f, ta, refresh, opts\)/.test(js), 'opts 未透传给 _upload');
    });
    check('编辑器支持直接粘贴图片', () => {
        const idx = fs.readFileSync(path.join(ROOT, 'static/js/editor/index.js'), 'utf8');
        const up = fs.readFileSync(path.join(ROOT, 'static/js/editor/upload-inline.js'), 'utf8');
        assert.ok(/addEventListener\('paste'/.test(idx), 'index.js 未监听 paste');
        assert.ok(/clipboardData/.test(idx), 'index.js 未读取剪贴板');
        assert.ok(/visibility:\s*root\.dataset\.imageVisibility/.test(idx), '粘贴上传未透传 visibility');
        assert.ok(/pasteFiles\(files, ta, previewApi\.refresh/.test(idx), '粘贴未调用上传组件');
        assert.ok(/pasteFiles\(files, ta, refresh, opts\)/.test(up), 'upload-inline.js 缺少 pasteFiles');
        assert.ok(/_upload\(file, ta, refresh, opts\)/.test(up), 'pasteFiles 未复用 _upload');
    });
    const up = multipart({ name: 'dm.png', mime: 'image/png', data: PNG });
    const uploaded = await req('POST', '/myfile/upload?visibility=public', {
        cookie: A,
        body: up.body,
        headers: { 'Content-Type': up.ct },
    });
    let file = null;
    try { file = JSON.parse(uploaded.body.toString('utf8')).file; } catch (e) {}
    check('公开图片上传成功', () => {
        assert.strictEqual(uploaded.status, 200);
        assert.ok(file && file.id, '响应缺少 file.id');
        const meta = storage.getUserFile(uidA, file.id);
        assert.strictEqual(meta && meta.visibility, 'public', '存储里不是 public');
    });
    if (file) {
        const seen = await req('GET', '/myfile/' + uidA + '/' + file.id, { cookie: B });
        check('对方能看到私信图片', () => {
            assert.strictEqual(seen.status, 200);
            assert.ok(Buffer.compare(seen.body, PNG) === 0, '图片内容不一致');
        });
    }
    const up2 = multipart({ name: 'priv.png', mime: 'image/png', data: PNG });
    const uploaded2 = await req('POST', '/myfile/upload', {
        cookie: A,
        body: up2.body,
        headers: { 'Content-Type': up2.ct },
    });
    let file2 = null;
    try { file2 = JSON.parse(uploaded2.body.toString('utf8')).file; } catch (e) {}
    if (file2) {
        const denied = await req('GET', '/myfile/' + uidA + '/' + file2.id, { cookie: B });
        check('未声明公开时仍默认 private', () => {
            assert.strictEqual(denied.status, 403);
        });
    }
    try {
        fs.writeFileSync(path.join(ROOT, 'cert.pem'), 'dummy');
        fs.writeFileSync(path.join(ROOT, 'key.pem'), 'dummy');
        const page = await req('GET', '/messages', { cookie: A });
        const html = page.body.toString('utf8');
        assert.ok(/__WS_PROTOCOL__\s*=\s*"ws"/.test(html),
            '中途补放 pem 后页面协议被改成了 wss');
        results.push(['PASS', '运行中补 pem 不改已锁定的协议']);
    } catch (e) {
        results.push(['FAIL', '运行中补 pem 不改已锁定的协议 -> ' + e.message]);
    } finally {
        clearTlsArtifacts(ROOT);
    }
    const H = require('../../lib/ws-protocol');
    check('WS 协议可被锁定', () => {
        H.setWsProtocol('wss');
        assert.strictEqual(H.getWsProtocol(), 'wss');
        H.setWsProtocol('ws');
        assert.strictEqual(H.getWsProtocol(), 'ws');
        H.setWsProtocol('');
    });
    check('server.js 启动时锁协议', () => {
        const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
        assert.ok(/setWsProtocol\(hasCert \? 'wss' : 'ws'\)/.test(src),
            'server.js 未在启动时锁定 WS 协议');
    });
    check('页面注入的是服务端锁定的协议', () => {
        const tpl = fs.readFileSync(path.join(ROOT, 'templates/base.html'), 'utf8');
        assert.ok(/__WS_PROTOCOL__\s*=\s*\{\{ \(ws_protocol/.test(tpl),
            'base.html 未使用服务端 ws_protocol');
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

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { sleep, waitForServer, clearTestArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
clearTestArtifacts(ROOT);
const PORT = 5197;
const proc = spawn(process.execPath, ['server.js'],
    { cwd: ROOT, env: { ...process.env, PORT } });
proc.stdout.on('data', () => {});
const srvErr = [];
proc.stderr.on('data', d => srvErr.push(String(d)));
const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
function req(method, p, { body, cookie } = {}) {
    return new Promise((resolve, reject) => {
        const h = {};
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            res => {
                let d = ''; res.on('data', c => d += c);
                res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
const cookieOf = r => (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
function open(ws, ms = 15000) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => { ws.off('open', onOpen); ws.off('error', onErr); rej(new Error('ws timeout')); }, ms);
        const onOpen = () => { clearTimeout(t); ws.off('error', onErr); res(); };
        const onErr = e => { clearTimeout(t); ws.off('open', onOpen); rej(e); };
        ws.on('open', onOpen);
        ws.on('error', onErr);
    });
}
async function openRetry(makeWs, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
        const ws = makeWs();
        try { await open(ws); return ws; } catch (e) { last = e; await sleep(500); }
    }
    throw last;
}
function waitFor(ws, pred, ms = 10000) {
    return new Promise((res, rej) => {
        const t = setTimeout(() => { ws.off('message', h); rej(new Error('timeout waiting for event')); }, ms);
        const h = raw => {
            let d; try { d = JSON.parse(raw.toString()); } catch (e) { return; }
            if (pred(d)) { clearTimeout(t); ws.off('message', h); res(d); }
        };
        ws.on('message', h);
    });
}
(async () => {
    await waitForServer(PORT);
    const storage = require('../../lib/storage');
    const A = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchA', password: 'pw123456', confirm_password: 'pw123456' } }));
    const B = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchB', password: 'pw123456', confirm_password: 'pw123456' } }));
    const C = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchC', password: 'pw123456', confirm_password: 'pw123456' } }));
    const uidA = storage.findUserByNickname('batchA').id;
    const uidB = storage.findUserByNickname('batchB').id;
    const uidC = storage.findUserByNickname('batchC').id;
    await check('批量：页面与脚本接线完整', async () => {
        const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
        const base = read('templates/base.html');
        assert.ok(base.includes('js/batch-select.js'));
        assert.ok(base.includes('js/chat/batch-messages.js'));
        for (const p of [
            'templates/myfile.html', 'templates/domain_files.html',
            'templates/manage_discussions.html', 'templates/manage_users.html',
            'templates/manage_join_applications.html', 'templates/manage_applications.html',
        ]) {
            const html = read(p);
            assert.ok(html.includes('data-batch-form'), p + ' 缺少批量表单');
            assert.ok(html.includes('data-batch-check'), p + ' 缺少选择框');
        }
        const discuss = read('templates/discuss.html');
        assert.ok(discuss.includes('id="messageBatchBar"'));
        assert.ok(discuss.includes('batchDeleteSelected()'));
        assert.ok(discuss.includes('mobile-discuss-tabs'));
        assert.ok(discuss.includes('id="mobilePaneChat"'));
        assert.ok(discuss.includes('aria-label="聊天"'));
        assert.ok(discuss.includes('for="mobilePaneSide"'));
        const discussCss = read('static/css/discuss.css');
        assert.ok(discussCss.includes(':focus-visible'));
        assert.ok(discussCss.includes('env(safe-area-inset-bottom'));
    });
    const f1 = storage.addUserFile(uidA, { filename: 'alpha.txt', mime: 'text/plain', buffer: Buffer.from('a') });
    const f2 = storage.addUserFile(uidA, { filename: 'beta.txt', mime: 'text/plain', buffer: Buffer.from('b') });
    await check('文件：批量置顶并排序到最前', async () => {
        const r = await req('POST', '/myfile/batch',
            { cookie: A, body: { ids: f1.id + ',' + f2.id, action: 'pin' } });
        assert.strictEqual(r.status, 302);
        const list = storage.listUserFiles(uidA);
        assert.strictEqual(list[0].pinned, true);
        assert.strictEqual(list[1].pinned, true);
    });
    await check('文件：批量查找替换重命名', async () => {
        const r = await req('POST', '/myfile/batch', {
            cookie: A,
            body: {
                ids: f1.id + ',' + f2.id, action: 'rename',
                mode: 'replace', find: 'a', replace: 'z',
            },
        });
        assert.strictEqual(r.status, 302);
        assert.strictEqual(storage.getUserFile(uidA, f1.id).filename, 'zlphz.txt');
        assert.strictEqual(storage.getUserFile(uidA, f2.id).filename, 'betz.txt');
    });
    await check('文件：批量可见性', async () => {
        const r = await req('POST', '/myfile/batch', {
            cookie: A,
            body: { ids: f1.id + ',' + f2.id, action: 'visibility', visibility: 'public' },
        });
        assert.strictEqual(r.status, 302);
        assert.strictEqual(storage.getUserFile(uidA, f1.id).visibility, 'public');
        assert.strictEqual(storage.getUserFile(uidA, f2.id).visibility, 'public');
    });
    await check('文件：批量操作任一无效则整体不执行', async () => {
        const before = storage.getUserFile(uidA, f1.id).filename;
        const r = await req('POST', '/myfile/batch', {
            cookie: A,
            body: {
                ids: f1.id + ',missing-file', action: 'rename',
                mode: 'prefix', value: 'x-',
            },
        });
        assert.strictEqual(r.status, 302);
        assert.strictEqual(storage.getUserFile(uidA, f1.id).filename, before);
    });
    const df1 = storage.addDomainFile('system', {
        filename: 'report-a.pdf', mime: 'application/pdf', buffer: Buffer.from('a'), uploader: uidA,
    });
    const df2 = storage.addDomainFile('system', {
        filename: 'report-b.pdf', mime: 'application/pdf', buffer: Buffer.from('b'), uploader: uidA,
    });
    await check('域文件：批量置顶与重命名', async () => {
        let r = await req('POST', '/domain/system/files/batch', {
            cookie: A,
            body: { ids: df1.id + ',' + df2.id, action: 'pin' },
        });
        assert.strictEqual(r.status, 302);
        assert.strictEqual(storage.getDomainFile('system', df1.id).pinned, true);
        r = await req('POST', '/domain/system/files/batch', {
            cookie: A,
            body: {
                ids: df1.id + ',' + df2.id, action: 'rename',
                mode: 'prefix', value: 'new-',
            },
        });
        assert.strictEqual(r.status, 302);
        assert.strictEqual(storage.getDomainFile('system', df1.id).filename, 'new-report-a.pdf');
    });
    await check('PDF 内联响应可被同源 iframe 预览', async () => {
        const r = await req('GET', '/domain/system/files/' + df1.id, { cookie: A });
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'] || '', /^application\/pdf/);
        assert.match(r.headers['content-disposition'] || '', /^inline/);
        assert.ok(!/sandbox/.test(r.headers['content-security-policy'] || ''));
    });
    storage.saveDiscussion('system', 'batch-disc', {
        name: 'batch-disc', title: 'Hello World', created_at: storage.nowIso(),
    });
    await check('讨论：批量置顶', async () => {
        const r = await req('POST', '/domain/system/manage/discussions',
            { cookie: A, body: { ids: 'batch-disc', action: 'batch-pin' } });
        assert.strictEqual(r.status, 302);
        assert.strictEqual(storage.loadDiscussion('system', 'batch-disc').pinned, true);
    });
    await check('讨论：批量改标题且不改 ID', async () => {
        const r = await req('POST', '/domain/system/manage/discussions', {
            cookie: A,
            body: {
                ids: 'batch-disc', action: 'batch-title',
                mode: 'replace', find: 'Hello', replace: 'Hi',
            },
        });
        assert.strictEqual(r.status, 302);
        const cfg = storage.loadDiscussion('system', 'batch-disc');
        assert.strictEqual(cfg.title, 'Hi World');
        assert.strictEqual(cfg.name, 'batch-disc');
    });
    const wsA = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: A } }));
    const wsB = await openRetry(() => new WebSocket(`ws://127.0.0.1:${PORT}/ws/discuss/system/general`,
        { headers: { Cookie: B } }));
    const ids = [];
    for (const content of ['batch one', 'batch two']) {
        const p = waitFor(wsB, d => d.type === 'new_message' && d.message.content === content);
        wsA.send(JSON.stringify({ type: 'message', content }));
        const d = await p;
        ids.push(d.message.id);
    }
    await check('消息：批量置顶', async () => {
        const p = waitFor(wsA, d => d.type === 'batch_result' && d.op === 'pin');
        wsA.send(JSON.stringify({ type: 'batch_pin', message_ids: ids, pinned: true }));
        await p;
        for (const id of ids) {
            assert.strictEqual(storage.findMessage('system', 'general', id).pinned, true);
        }
    });
    await check('消息：批量删除会清掉置顶标记', async () => {
        const p = waitFor(wsA, d => d.type === 'batch_result' && d.op === 'delete');
        wsA.send(JSON.stringify({ type: 'batch_delete', message_ids: ids }));
        await p;
        for (const id of ids) {
            const m = storage.findMessage('system', 'general', id);
            assert.strictEqual(m.deleted, true);
            assert.strictEqual(m.pinned, false);
        }
    });
    await check('消息：批量删除任一无效则整体不执行', async () => {
        const m = { id: 'batch-keep', user_id: uidA, nickname: 'batchA', content: 'keep', created_at: storage.nowIso() };
        storage.appendMessage('system', 'general', m);
        const p = waitFor(wsA, d => d.type === 'error');
        wsA.send(JSON.stringify({ type: 'batch_delete', message_ids: ['batch-keep', 'missing-id'] }));
        await p;
        assert.ok(!storage.findMessage('system', 'general', 'batch-keep').deleted);
    });
    wsA.close(); wsB.close();
    await check('管理：创建测试域', async () => {
        const r = await req('POST', '/create/domain', {
            cookie: A, body: { name: 'batchdom', display_name: 'Batch Domain' },
        });
        assert.strictEqual(r.status, 302);
        assert.ok(storage.domainExists('batchdom'));
    });
    let dom = storage.loadDomain('batchdom');
    dom.join_applications = [
        { uid: uidB, nickname: 'batchB', message: 'b', created_at: storage.nowIso() },
        { uid: uidC, nickname: 'batchC', message: 'c', created_at: storage.nowIso() },
    ];
    storage.saveDomain('batchdom', dom);
    await check('域申请：批量通过与拒绝', async () => {
        let r = await req('POST', '/domain/batchdom/manage/applications',
            { cookie: A, body: { ids: uidB, action: 'approve' } });
        assert.strictEqual(r.status, 302);
        dom = storage.loadDomain('batchdom');
        assert.ok(dom.members[uidB], '通过后未加入成员');
        assert.ok(dom.join_applications.some(a => a.uid === uidC), '未选中的申请被误删');
        r = await req('POST', '/domain/batchdom/manage/applications',
            { cookie: A, body: { ids: uidC, action: 'reject' } });
        assert.strictEqual(r.status, 302);
        dom = storage.loadDomain('batchdom');
        assert.ok(!dom.members[uidC]);
        assert.ok(!dom.join_applications.some(a => a.uid === uidC));
    });
    dom = storage.loadDomain('batchdom');
    dom.join_applications = [
        { uid: uidB, nickname: 'batchB', message: 'again', created_at: storage.nowIso() },
    ];
    storage.saveDomain('batchdom', dom);
    await check('全局申请：批量通过', async () => {
        const r = await req('POST', '/manage/join_applications', {
            cookie: A,
            body: { application_ids: 'batchdom:' + uidB, action: 'approve' },
        });
        assert.strictEqual(r.status, 302);
        dom = storage.loadDomain('batchdom');
        assert.ok(dom.members[uidB]);
        assert.strictEqual(dom.join_applications.length, 0);
    });
    await check('管理用户：批量封禁/解封，且拒绝自己', async () => {
        let r = await req('POST', '/manage/users/batch',
            { cookie: A, body: { ids: uidB, action: 'ban', reason: 'test' } });
        assert.strictEqual(r.status, 302);
        assert.strictEqual(storage.loadUser(uidB).banned, true);
        r = await req('POST', '/manage/users/batch',
            { cookie: A, body: { ids: uidB, action: 'unban' } });
        assert.strictEqual(r.status, 302);
        assert.ok(!storage.loadUser(uidB).banned);
        r = await req('POST', '/manage/users/batch',
            { cookie: A, body: { ids: uidA, action: 'ban', reason: 'self' } });
        assert.strictEqual(r.status, 302);
        assert.ok(!storage.loadUser(uidA).banned);
    });
    dom = storage.loadDomain('batchdom');
    dom.join_applications = [
        { uid: uidC, nickname: 'batchC', message: 'render', created_at: storage.nowIso() },
    ];
    storage.saveDomain('batchdom', dom);
    await check('批量：相关页面可渲染', async () => {
        const pages = [
            ['/myfile', A, 'data-batch-form'],
            ['/domain/system/files', A, 'data-batch-form'],
            ['/domain/system/manage/discussions', A, 'data-batch-form'],
            ['/domain/system/discuss/general', A, 'messageBatchBar'],
            ['/manage/users', A, 'data-batch-form'],
            ['/manage/join_applications', A, 'data-batch-form'],
            ['/domain/batchdom/manage/applications', A, 'data-batch-form'],
            ['/help', A, 'id="batch"'],
        ];
        for (const [p, cookie, marker] of pages) {
            const r = await req('GET', p, { cookie });
            assert.strictEqual(r.status, 200, p + ' 返回 ' + r.status);
            assert.ok(r.body.includes(marker), p + ' 缺少 ' + marker);
        }
    });
    await check('批量测试：服务端无异常', () => {
        assert.strictEqual(srvErr.length, 0, srvErr.join(''));
    });
    proc.kill();
    for (const row of results) console.log(row[0] + '  ' + row[1]);
    const failed = results.filter(r => r[0] === 'FAIL').length;
    console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
})().catch(e => {
    console.error(e);
    proc.kill();
    process.exitCode = 1;
});

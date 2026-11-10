'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const storage = require('../../lib/storage');
const chunks = require('../../lib/storage/chunks');
const registry = require('../../lib/websocket/registry');
const { parseForm, parseMultipart } = require('../../lib/http-utils');
const { buildZip } = require('../../lib/zip');
const results = [];
async function check(name, fn) {
    try {
        await fn();
        results.push(['PASS', name]);
    } catch (e) {
        results.push(['FAIL', name + ' -> ' + e.message]);
    }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();
(async () => {
    await check('表单与 multipart 字段不会污染原型', () => {
        const form = parseForm('__proto__=x&constructor=y&ok=1');
        assert.strictEqual(Object.getPrototypeOf(form), Object.prototype);
        assert.strictEqual(form.ok, '1');
        assert.strictEqual(form.__proto__, Object.prototype);
        const boundary = 'X';
        const body = `--${boundary}\r\nContent-Disposition: form-data; name="__proto__"\r\n\r\nx\r\n`
            + `--${boundary}\r\nContent-Disposition: form-data; name="ok"\r\n\r\n1\r\n`
            + `--${boundary}--\r\n`;
        const parsed = parseMultipart(Buffer.from(body), boundary);
        assert.deepStrictEqual(Object.keys(parsed), ['ok']);
    });
    await check('超大请求在读取正文前返回 413', async () => {
        const server = http.createServer(require('../../lib/routes').handleRequest);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        try {
            const result = await new Promise((resolve, reject) => {
                const req = http.request({
                    host: '127.0.0.1', port, path: '/login', method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': String(3 * 1024 * 1024),
                        'Origin': `http://127.0.0.1:${port}`,
                        'Connection': 'close',
                    },
                }, (res) => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', (c) => { body += c; });
                    res.on('end', () => resolve({ status: res.statusCode, body }));
                });
                req.on('error', reject);
                req.end();
            });
            assert.strictEqual(result.status, 413);
            assert.ok(result.body.includes('请求内容过大'));
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
    await check('在线状态按连接计数增量维护且不再扫描全部用户', () => {
        storage.setOnline('perf-online', 'dom-a', true);
        storage.setOnline('perf-online', 'dom-a', true);
        assert.strictEqual(storage.isOnlineAnywhere('perf-online'), true);
        assert.deepStrictEqual(storage.listOnline('dom-a'), ['perf-online']);
        storage.setOnline('perf-online', 'dom-a', false);
        assert.strictEqual(storage.isOnlineAnywhere('perf-online'), true);
        storage.setOnline('perf-online', 'dom-a', false);
        assert.strictEqual(storage.isOnlineAnywhere('perf-online'), false);
        assert.deepStrictEqual(storage.listOnline('dom-a'), []);
        assert.ok(!read('lib/websocket/status.js').includes('listRealUsers'));
        assert.ok(!read('lib/websocket/discuss.js').includes('listRealUsers'));
    });
    await check('WebSocket 广播会跳过慢客户端并主动断开', () => {
        let sent = 0;
        let closed = 0;
        const slow = {
            readyState: 1,
            bufferedAmount: registry.MAX_BUFFERED_BYTES + 1,
            send() { sent++; },
            close() { closed++; },
        };
        registry.sendTo(slow, 'x');
        assert.strictEqual(sent, 0);
        assert.strictEqual(closed, 1);
        const fast = { readyState: 1, bufferedAmount: 0, send() { sent++; } };
        registry.sendTo(fast, 'y');
        assert.strictEqual(sent, 1);
    });
    await check('分片读取复用缓存，写入后立即失效', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-chunk-'));
        try {
            chunks.writeChunk(dir, 'chunk-00001.jsonl', [{ id: 'a' }]);
            const first = chunks.readAllChunks(dir);
            const second = chunks.readAllChunks(dir);
            assert.strictEqual(first.chunks[0].arr, second.chunks[0].arr);
            chunks.appendLine(dir, 'chunk-00001.jsonl', { id: 'b' });
            const third = chunks.readAllChunks(dir);
            assert.strictEqual(third.chunks[0].arr.length, 2);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    await check('讨论消息使用统计与游标分页且不复用全量扫描', () => {
        const dn = 'perf-guard-page';
        const all = [];
        for (let i = 0; i < 205; i++) {
            all.push({
                id: 'm' + i, user_id: '1', nickname: 'u', content: 'c' + i,
                created_at: new Date(1700000000000 + i * 1000).toISOString(),
                deleted: i === 4, pinned: i === 8,
            });
        }
        try {
            storage.saveAllMessages(dn, 'general', all);
            const stats = storage.getMessageStats(dn, 'general');
            assert.strictEqual(stats.total, 204);
            assert.strictEqual(stats.pinned.length, 1);
            const first = storage.loadMessagePage(dn, 'general', { limit: 100 });
            assert.strictEqual(first.messages.length, 100);
            assert.strictEqual(first.messages[0].id, 'm105');
            assert.strictEqual(first.messages[99].id, 'm204');
            assert.strictEqual(first.has_more, true);
            const second = storage.loadMessagePage(dn, 'general', {
                limit: 100, beforeId: first.next_before,
            });
            assert.strictEqual(second.messages.length, 100);
            assert.strictEqual(second.messages[0].id, 'm5');
            assert.strictEqual(second.messages[99].id, 'm104');
            assert.strictEqual(second.has_more, true);
            const third = storage.loadMessagePage(dn, 'general', {
                limit: 100, beforeId: second.next_before,
            });
            assert.strictEqual(third.messages.length, 4);
            assert.strictEqual(third.messages[0].id, 'm0');
            assert.strictEqual(third.messages[3].id, 'm3');
            assert.strictEqual(third.has_more, false);
            storage.appendMessage(dn, 'general', {
                id: 'm205', user_id: '1', nickname: 'u', content: 'c205',
                created_at: new Date(1700000205000).toISOString(),
            });
            assert.strictEqual(storage.getMessageStats(dn, 'general').total, 205);
            storage.updateMessage(dn, 'general', 'm205', { deleted: true });
            assert.strictEqual(storage.getMessageStats(dn, 'general').total, 204);
            assert.ok(!read('lib/routes/discuss.js').includes('storage.loadAllMessages'));
        } finally {
            fs.rmSync(path.join(ROOT, 'data', 'domains', dn), {
                recursive: true, force: true,
            });
        }
    });
    await check('私信使用游标分页且会话索引保存最后一条', () => {
        const A = 'perf-guard-dm-page-a';
        const B = 'perf-guard-dm-page-b';
        const all = [];
        for (let i = 0; i < 205; i++) {
            all.push({
                id: 'd' + i, from: A, to: B, content: 'c' + i,
                read: false, created_at: new Date(1700000000000 + i * 1000).toISOString(),
                deleted: i === 204,
            });
        }
        try {
            storage.saveAllDM(A, B, all);
            const first = storage.loadDMPage(A, B, { limit: 100 });
            assert.strictEqual(first.messages.length, 100);
            assert.strictEqual(first.messages[0].id, 'd104');
            assert.strictEqual(first.messages[99].id, 'd203');
            assert.strictEqual(first.has_more, true);
            const second = storage.loadDMPage(A, B, {
                limit: 100, beforeId: first.next_before,
            });
            assert.strictEqual(second.messages.length, 100);
            assert.strictEqual(second.messages[0].id, 'd4');
            assert.strictEqual(second.messages[99].id, 'd103');
            assert.strictEqual(second.has_more, true);
            const third = storage.loadDMPage(A, B, {
                limit: 100, beforeId: second.next_before,
            });
            assert.strictEqual(third.messages.length, 4);
            assert.strictEqual(third.messages[0].id, 'd0');
            assert.strictEqual(third.has_more, false);
            const idx = storage.rebuildConvIndex(A);
            assert.strictEqual(idx[B].last.id, 'd203');
            assert.strictEqual(idx[B].last.content, 'c203');
        } finally {
            fs.rmSync(path.join(ROOT, 'data', 'users', A), { recursive: true, force: true });
            fs.rmSync(path.join(ROOT, 'data', 'users', B), { recursive: true, force: true });
        }
    });
    await check('私信只读取最新分片且跳过删除项', () => {
        const A = 'perf-guard-a';
        const B = 'perf-guard-b';
        const all = [];
        for (let i = 0; i < 520; i++) {
            all.push({
                id: 'm' + i, from: A, to: B, content: 'x',
                read: false, created_at: new Date(1700000000000 + i * 1000).toISOString(),
            });
        }
        all[519].deleted = true;
        try {
            storage.saveAllDM(A, B, all);
            const got = storage.loadDM(A, B, 5);
            assert.deepStrictEqual(got.map(m => m.id), ['m514', 'm515', 'm516', 'm517', 'm518']);
        } finally {
            fs.rmSync(path.join(ROOT, 'data', 'users', A), { recursive: true, force: true });
            fs.rmSync(path.join(ROOT, 'data', 'users', B), { recursive: true, force: true });
        }
    });
    await check('ZIP 条目数超过 65535 时拒绝生成', () => {
        const entries = Array.from({ length: 65536 }, (_, i) => ({ name: 'f' + i, data: '' }));
        assert.throws(() => buildZip(entries), /65535/);
    });
    await check('模板缓存已开启', () => {
        assert.ok(/noCache:\s*false/.test(read('lib/template.js')));
    });
    await check('服务器已设置请求头与请求体超时', () => {
        const src = read('server.js');
        assert.ok(src.includes('server.requestTimeout'));
        assert.ok(src.includes('server.headersTimeout'));
        assert.ok(src.includes('server.keepAliveTimeout'));
        assert.ok(src.includes('clientError'));
    });
    await check('WebSocket 已启用错误监听与心跳', () => {
        const src = read('lib/websocket/index.js');
        assert.ok(src.includes("ws.on('error'"));
        assert.ok(src.includes("ws.on('pong'"));
        assert.ok(src.includes('HEARTBEAT_MS'));
    });
    await check('静态文件流会在连接关闭时销毁', () => {
        assert.ok(read('lib/routes/_static.js').includes("res.on('close'"));
    });
    await check('备份会跳过临时文件与旧快照', () => {
        const src = read('lib/backup.js');
        assert.ok(src.includes("ent.name.includes('.tmp-')"));
        assert.ok(src.includes("ent.name.startsWith('.snapshot-')"));
        assert.ok(src.includes("ent.name.includes('.bak-')"));
    });
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const failed = results.filter(r => r[0] === 'FAIL').length;
    console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();

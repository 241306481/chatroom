'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { sleep, waitForServer, clearTestArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
clearTestArtifacts(ROOT);
const PORT = 5197;
let proc = null;
const srvErr = [];
const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
async function startServer() {
    proc = spawn(process.execPath, ['server.js'],
        { cwd: ROOT, env: { ...process.env, PORT } });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', d => srvErr.push(String(d)));
    await waitForServer(PORT);
}
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
            res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const rawBody = Buffer.concat(chunks);
                    resolve({
                        status: res.statusCode, headers: res.headers,
                        body: rawBody.toString('utf8'), rawBody,
                    });
                });
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
const cookieOf = r => (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
function assertJsonOk(r) {
    assert.strictEqual(r.status, 200, r.body);
    const data = JSON.parse(r.body);
    assert.strictEqual(data.ok, true, r.body);
    return data;
}
function assertJsonFail(r) {
    assert.strictEqual(r.status, 200, r.body);
    const data = JSON.parse(r.body);
    assert.strictEqual(data.ok, false, r.body);
    return data;
}
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
async function setupUsers() {
    const storage = require('../../lib/storage');
    const messageView = require('../../lib/message-view');
    const viewContent = m => m && m.forwarded_from
        ? messageView.forwardContent(m.forwarded_from)
        : String((m && m.content) || '');
    const A = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchA', password: 'pw123456', confirm_password: 'pw123456' } }));
    const B = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchB', password: 'pw123456', confirm_password: 'pw123456' } }));
    const C = cookieOf(await req('POST', '/register',
        { body: { nickname: 'batchC', password: 'pw123456', confirm_password: 'pw123456' } }));
    const uidA = storage.findUserByNickname('batchA').id;
    const uidB = storage.findUserByNickname('batchB').id;
    const uidC = storage.findUserByNickname('batchC').id;
    return { storage, messageView, viewContent, A, B, C, uidA, uidB, uidC };
}
function stopServer() {
    if (proc) { try { proc.kill(); } catch (e) {} proc = null; }
}
async function finish(title) {
    if (srvErr.length) results.push(['FAIL', '服务端异常 -> ' + srvErr.join('').slice(0, 500)]);
    stopServer();
    await sleep(300);
    console.log('\n======== [回归] ' + title + ' ========');
    for (const row of results) console.log(row[0] + '  ' + row[1]);
    const failed = results.filter(r => r[0] === 'FAIL').length;
    console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
}
function fatal(e) {
    console.error(e);
    stopServer();
    process.exit(2);
}
module.exports = {
    assert, http, path, spawn, WebSocket, sleep, waitForServer,
    clearTestArtifacts, ROOT, PORT, check, req, cookieOf, assertJsonOk,
    assertJsonFail, open, openRetry, waitFor, startServer, setupUsers,
    stopServer, finish, fatal,
};

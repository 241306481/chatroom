'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { WebSocket } = require('ws');
const { sleep, waitForServer, clearTestArtifacts } = require('./_helpers');
const ROOT = path.join(__dirname, '..', '..');
const PORT = 5199;
const BASE = 'http://127.0.0.1:' + PORT;
const WS_URL = 'ws://127.0.0.1:' + PORT + '/ws/discuss/system/general';
const { PRIV, PERM, SYSTEM_ROLES_BUILTIN } = require('../../lib/permissions');
const { checkDual } = require('../../lib/auth/privilege');
const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
clearTestArtifacts(ROOT);
const storage = require('../../lib/storage');
const auth = require('../../lib/auth');
const sysRoles = require('../../lib/storage/system-roles');
storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();
const rootId = storage.createUser('rootx', 'pw123456');
const opsId = storage.createUser('opsx', 'pw123456');
const viewerId = storage.createUser('viewx', 'pw123456');
const adminId = storage.createUser('adminx', 'pw123456');
const dmodId = storage.createUser('dmodx', 'pw123456');
sysRoles.createRole('sysops', 'SysOps');
const opsPrivs = JSON.parse(JSON.stringify(SYSTEM_ROLES_BUILTIN.member.privs));
opsPrivs.base = (opsPrivs.base & ~PRIV.BASE.VIEW_ALL_DOMAIN) >>> 0;
opsPrivs.system = PRIV.SYSTEM.MANAGE_PANEL | PRIV.SYSTEM.MANAGE_SYS_PERMS;
sysRoles.saveRolePrivs('sysops', opsPrivs);
const opsUser = storage.loadUser(opsId);
opsUser.system_role = 'sysops';
storage.saveUser(opsId, opsUser);
sysRoles.createRole('viewall', 'ViewAll');
const viewPrivs = JSON.parse(JSON.stringify(SYSTEM_ROLES_BUILTIN.member.privs));
viewPrivs.base = viewPrivs.base | PRIV.BASE.VIEW_ALL_DOMAIN;
sysRoles.saveRolePrivs('viewall', viewPrivs);
const viewerUser = storage.loadUser(viewerId);
viewerUser.system_role = 'viewall';
storage.saveUser(viewerId, viewerUser);
auth.setSystemRole(adminId, 'admin');
storage.createDomain('opend', 'OpenD', rootId);
{
    const d = storage.loadDomain('opend');
    d.join_policy = 'approval';
    d.roles = d.roles || {};
    d.roles.ace = { display: 'Ace', perm: { hi: PERM.ALL.hi, lo: PERM.ALL.lo } };
    d.roles.dmod = {
        display: 'DMod',
        perm: { hi: 0, lo: (PERM.MANAGE.USER.lo | PERM.MANAGE.ROLE.lo) >>> 0 },
    };
    d.members[dmodId] = {
        role: 'dmod', level: 0, exp: 0, joined_at: storage.nowIso(),
    };
    storage.saveDomain('opend', d);
}
const mentionIds = [];
for (let i = 0; i < 30; i++) mentionIds.push(storage.createUser('mention' + i, 'pw123456'));
{
    const d = storage.loadDomain('opend');
    for (const id of mentionIds) {
        d.members[id] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
    }
    storage.saveDomain('opend', d);
}
const privateFile = storage.addUserFile(rootId, {
    filename: 'secret.txt', mime: 'text/plain',
    buffer: Buffer.from('private-content'), visibility: 'private',
});
const publicFile = storage.addUserFile(rootId, {
    filename: 'open.txt', mime: 'text/plain',
    buffer: Buffer.from('public-content'), visibility: 'public',
});
const htmlFile = storage.addUserFile(rootId, {
    filename: 'evil.html', mime: 'text/html',
    buffer: Buffer.from('<script>alert(1)</script>'), visibility: 'public',
});
const textFile = storage.addUserFile(rootId, {
    filename: 'note.txt', mime: 'text/plain',
    buffer: Buffer.from('<script>alert(1)</script>'), visibility: 'public',
});
function request(method, p, { body, cookie, headers, origin = true } = {}) {
    return new Promise((resolve, reject) => {
        const h = Object.assign({}, headers || {});
        if (origin) h.Origin = origin === true ? BASE : origin;
        if (cookie) h.Cookie = cookie;
        let payload = body;
        if (body) {
            payload = Buffer.from(new URLSearchParams(body).toString());
            h['Content-Type'] = 'application/x-www-form-urlencoded';
            h['Content-Length'] = payload.length;
        }
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: h },
            res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end', () => resolve({
                    status: res.statusCode, headers: res.headers, body: d,
                }));
            });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}
const get = (p, cookie) => request('GET', p, { cookie });
const post = (p, body, cookie) => request('POST', p, { body, cookie });
const cookieOf = r => (r.headers['set-cookie'] || [])
    .map(c => c.split(';')[0]).join('; ');
const tryOpen = ws => new Promise(r => {
    ws.on('open', () => r(true));
    ws.on('error', () => r(false));
    setTimeout(() => r(false), 2500);
});
const waitClose = ws => new Promise(r => {
    if (ws.readyState === WebSocket.CLOSED) return r(true);
    ws.on('close', () => r(true));
    setTimeout(() => r(false), 2500);
});
let proc = null;
async function startServer() {
    proc = spawn(process.execPath, ['server.js'],
        { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});
    await waitForServer(PORT);
}
async function loginUsers() {
    const rootC = cookieOf(await post('/login', { nickname: 'rootx', password: 'pw123456' }));
    const opsC = cookieOf(await post('/login', { nickname: 'opsx', password: 'pw123456' }));
    const viewerC = cookieOf(await post('/login', { nickname: 'viewx', password: 'pw123456' }));
    const dmodC = cookieOf(await post('/login', { nickname: 'dmodx', password: 'pw123456' }));
    return { rootC, opsC, viewerC, dmodC };
}
function stopServer() {
    if (proc) { try { proc.kill(); } catch (e) {} proc = null; }
}
async function finish(title) {
    stopServer();
    await sleep(300);
    clearTestArtifacts(ROOT);
    if (!results.some(r => r[0] === 'FAIL')) {
        try { fs.rmSync(path.join(ROOT, 'logs'), { recursive: true, force: true }); } catch (e) {}
    }
    console.log('\n======== [回归] ' + title + ' ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
}
function fatal(e) {
    console.error('SUITE ERROR', e && e.message);
    stopServer();
    clearTestArtifacts(ROOT);
    process.exit(2);
}
module.exports = {
    assert, fs, path, http, spawn, WebSocket, sleep, waitForServer,
    clearTestArtifacts, ROOT, PORT, BASE, WS_URL, PRIV, PERM,
    SYSTEM_ROLES_BUILTIN, checkDual, results, check, storage, auth,
    sysRoles, rootId, opsId, viewerId, adminId, dmodId, mentionIds,
    privateFile, publicFile, htmlFile, textFile, request, get, post,
    cookieOf, tryOpen, waitClose, startServer, loginUsers, stopServer,
    finish, fatal,
};

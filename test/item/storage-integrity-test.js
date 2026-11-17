'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const storage = require('../../lib/storage');
const paths = require('../../lib/storage/paths');
const fsUtils = require('../../lib/storage/fs-utils');
const ipBans = require('../../lib/storage/ip-bans');
const attachmentStore = require('../../lib/storage/attachment-store');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();
const A = storage.createUser('integrityA', 'pw123456');
check('原子写失败后不留下临时文件', () => {
    const target = path.join(DATA, 'atomic.json');
    const realRename = fs.renameSync;
    fs.renameSync = () => { throw new Error('simulated rename failure'); };
    try {
        assert.throws(
            () => fsUtils.writeJsonAtomic(target, { ok: true }),
            /simulated rename failure/);
    } finally {
        fs.renameSync = realRename;
    }
    const leftovers = fs.readdirSync(DATA)
        .filter((f) => f.startsWith('atomic.json.tmp-'));
    assert.deepStrictEqual(leftovers, []);
});
check('系统账户缺失目录会被补建', () => {
    const uid = storage.SYSTEM_UID;
    fs.rmSync(paths.userFilesDir(uid), { recursive: true, force: true });
    fs.rmSync(paths.userMsgDir(uid), { recursive: true, force: true });
    storage.ensureSystemUser();
    assert.ok(fs.existsSync(paths.userFilesDir(uid)));
    assert.ok(fs.existsSync(paths.userMsgDir(uid)));
});
check('system 域缺失 general 时会被补建', () => {
    fs.rmSync(paths.discussDir('system', 'general'), { recursive: true, force: true });
    fs.rmSync(paths.domainFilesDir('system'), { recursive: true, force: true });
    storage.ensureSystemDomain();
    assert.strictEqual(storage.loadDiscussion('system', 'general').name, 'general');
    assert.ok(fs.existsSync(paths.domainFilesDir('system')));
});
check('新增文件时文件名会被清洗', () => {
    const uf = storage.addUserFile(A, {
        filename: '../evil/name.txt', mime: 'text/plain', buffer: Buffer.from('u'),
    });
    assert.strictEqual(uf.filename, '.._evil_name.txt');
    storage.createDomain('integritydom', 'Integrity', A);
    const df = storage.addDomainFile('integritydom', {
        filename: 'a/b.txt', mime: 'text/plain', buffer: Buffer.from('d'), uploader: A,
    });
    assert.strictEqual(df.filename, 'a_b.txt');
});
check('重命名讨论时会释放旧追加句柄', () => {
    const dn = 'rename-handle-dom';
    storage.createDomain(dn, 'Rename Handle', A);
    storage.appendMessage(dn, 'general', {
        id: 'keep-1', content: 'one', created_at: storage.nowIso(),
    });
    storage.renameDiscussion(dn, 'general', 'renamed');
    assert.ok(!fs.existsSync(paths.discussDir(dn, 'general')));
    assert.strictEqual(storage.loadDiscussion(dn, 'renamed').name, 'renamed');
    storage.appendMessage(dn, 'renamed', {
        id: 'keep-2', content: 'two', created_at: storage.nowIso(),
    });
    assert.deepStrictEqual(
        storage.loadAllMessages(dn, 'renamed').map((m) => m.id),
        ['keep-1', 'keep-2']);
    storage.deleteDomain(dn);
});
check('未读计数会忽略非法值与负数', () => {
    const B = storage.createUser('integrityB', 'pw123456');
    storage.appendDM(A, B, 'hello');
    fs.writeFileSync(paths.unreadCountPath(B), JSON.stringify({
        [A]: '3', ghost: -2, bad: 'x',
    }), 'utf8');
    assert.strictEqual(storage.getTotalUnread(B), 3);
    assert.deepStrictEqual(storage.loadUnreadCount(B), { [A]: 3 });
});
check('用户配置是标量或数组时按空对象处理', () => {
    const uid = storage.createUser('integrityC', 'pw123456');
    const file = paths.userConfigPath(uid);
    const original = fs.readFileSync(file, 'utf8');
    for (const bad of ['"str"', '[]', '123', 'true', 'null']) {
        fs.writeFileSync(file, bad, 'utf8');
        assert.deepStrictEqual(storage.loadUser(uid), {}, bad + ' 应按空对象处理');
    }
    fs.writeFileSync(file, original, 'utf8');
    assert.strictEqual(storage.loadUser(uid).id, uid);
});
check('域配置是标量或数组时按空对象处理', () => {
    const dn = 'scalar-config-dom';
    storage.createDomain(dn, 'Scalar Config', A);
    const file = paths.domainConfigPath(dn);
    for (const bad of ['"str"', '[]', '123', 'true']) {
        fs.writeFileSync(file, bad, 'utf8');
        assert.deepStrictEqual(storage.loadDomain(dn), {}, bad + ' 应按空对象处理');
    }
    storage.deleteDomain(dn);
});
check('讨论配置是标量或数组时按空对象处理', () => {
    const dn = 'scalar-disc-dom';
    storage.createDomain(dn, 'Scalar Discuss', A);
    storage.saveDiscussion(dn, 'scalar', { name: 'scalar', title: 't' });
    const file = paths.discussConfigPath(dn, 'scalar');
    for (const bad of ['"str"', '[]', '123', 'true']) {
        fs.writeFileSync(file, bad, 'utf8');
        assert.deepStrictEqual(storage.loadDiscussion(dn, 'scalar'), {}, bad + ' 应按空对象处理');
    }
    storage.deleteDomain(dn);
});
check('IP 封禁文件是数组时按空规则处理而不是写回数组', () => {
    const file = path.join(DATA, 'ip_bans.json');
    fs.writeFileSync(file, '[]', 'utf8');
    ipBans.addBan('203.0.113.9', { reason: 'test', until: '', by: 'test' });
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(Array.isArray(data.rules));
    assert.strictEqual(data.rules.length, 1);
    assert.strictEqual(data.rules[0].rule, '203.0.113.9');
    ipBans.removeByRule('203.0.113.9');
});
check('用户文件索引中的非对象条目不会导致操作异常', () => {
    const f = storage.addUserFile(A, {
        filename: 'valid-meta.txt', mime: 'text/plain', buffer: Buffer.from('x'),
    });
    const file = paths.userFilesIndexPath(A);
    fs.writeFileSync(file, JSON.stringify({
        files: { bad: null, arr: [], str: 'x', [f.id]: f },
    }), 'utf8');
    assert.deepStrictEqual(storage.listUserFiles(A).map(x => x.id), [f.id]);
    assert.throws(() => storage.renameUserFile(A, 'bad', 'x.txt'), /文件不存在/);
    assert.throws(() => storage.setUserFileVisibility(A, 'bad', 'public'), /文件不存在/);
    assert.throws(() => storage.renameUserFiles(A, [{ id: 'bad', filename: 'x.txt' }]),
        /文件不存在/);
});
check('域文件索引中的非对象条目不会导致操作异常', () => {
    const dn = 'bad-meta-files-dom';
    storage.createDomain(dn, 'Bad Meta Files', A);
    const f = storage.addDomainFile(dn, {
        filename: 'valid-meta.txt', mime: 'text/plain', buffer: Buffer.from('x'), uploader: A,
    });
    const file = paths.domainFilesIndexPath(dn);
    fs.writeFileSync(file, JSON.stringify({
        files: { bad: null, arr: [], str: 'x', [f.id]: f },
    }), 'utf8');
    assert.deepStrictEqual(storage.listDomainFiles(dn).map(x => x.id), [f.id]);
    assert.throws(() => storage.renameDomainFile(dn, 'bad', 'x.txt'), /文件不存在/);
    assert.throws(() => storage.setDomainFilesPinned(dn, ['bad'], true), /文件不存在/);
    assert.throws(() => storage.renameDomainFiles(dn, [{ id: 'bad', filename: 'x.txt' }]),
        /文件不存在/);
    storage.deleteDomain(dn);
});
check('附件索引中的非对象条目不会导致读取异常', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatroom-attach-index-'));
    const file = path.join(dir, 'index.json');
    fs.writeFileSync(file, JSON.stringify({
        files: { bad: null, arr: [], str: 'x', good: { id: 'good', refs: {} } },
    }), 'utf8');
    assert.strictEqual(attachmentStore.getAttachment(file, 'bad'), null);
    assert.deepStrictEqual(attachmentStore.listAttachments(file).map(m => m.id), ['good']);
    assert.strictEqual(attachmentStore.addRef(file, 'bad', 'u:1', 1), null);
    assert.deepStrictEqual(
        attachmentStore.releaseRef(file, path.join(dir, 'files'), 'bad', 'u:1'),
        { deleted: false, meta: null });
    fs.rmSync(dir, { recursive: true, force: true });
});
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

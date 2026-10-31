'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const storage = require('../../lib/storage');
const paths = require('../../lib/storage/paths');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
storage.ensureDirs();
storage.ensureSystemUser();
storage.ensureSystemDomain();
const A = storage.createUser('dmstoreA', 'pw123456');
const B = storage.createUser('dmstoreB', 'pw123456');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
let first;
check('私信写入双方独立分片', () => {
    first = storage.appendDM(A, B, 'hello');
    assert.ok(fs.existsSync(path.join(paths.dmMessagesDir(A, B), 'chunk-00001.jsonl')));
    assert.ok(fs.existsSync(path.join(paths.dmMessagesDir(B, A), 'chunk-00001.jsonl')));
    const a = storage.loadAllDM(A, B);
    const b = storage.loadAllDM(B, A);
    assert.strictEqual(a.length, 1);
    assert.strictEqual(b.length, 1);
    assert.strictEqual(a[0].id, first.id);
    assert.strictEqual(b[0].id, first.id);
});
check('会话索引与未读只属于接收方', () => {
    assert.strictEqual(storage.listConversations(A).length, 1);
    assert.strictEqual(storage.listConversations(B).length, 1);
    assert.strictEqual(storage.getTotalUnread(A), 0);
    assert.strictEqual(storage.getTotalUnread(B), 1);
    storage.markDMRead(B, A);
    assert.strictEqual(storage.getTotalUnread(B), 0);
    assert.strictEqual(storage.loadAllDM(A, B)[0].read, false);
    assert.strictEqual(storage.loadAllDM(B, A)[0].read, true);
});
check('单侧删除不影响对端副本', () => {
    assert.strictEqual(storage.deleteDMMessage(B, A, first.id), true);
    assert.strictEqual(storage.loadAllDM(B, A)[0].deleted, true);
    assert.strictEqual(storage.loadAllDM(A, B)[0].deleted, undefined);
    assert.strictEqual(storage.loadDM(B, A).length, 0);
    assert.strictEqual(storage.loadDM(A, B).length, 1);
});
check('单侧清空只移除自己的日志与索引', () => {
    storage.appendDM(A, B, 'second');
    storage.deleteDMConversation(B, A);
    assert.strictEqual(storage.loadAllDM(B, A).length, 0);
    assert.ok(storage.loadAllDM(A, B).length >= 2);
    assert.strictEqual(storage.getTotalUnread(B), 0);
    assert.strictEqual(storage.listConversations(B).length, 0);
});
check('单侧删除后对端未读与消息仍一致', () => {
    const msg = storage.appendDM(A, B, 'unread-stays');
    assert.strictEqual(storage.getTotalUnread(B), 1);
    assert.strictEqual(storage.listConversations(B)[0].unread, 1);
    storage.deleteDMMessage(A, B, msg.id);
    assert.strictEqual(storage.getTotalUnread(B), 1);
    assert.strictEqual(storage.listConversations(B)[0].unread, 1);
    assert.ok(storage.loadDM(B, A).some(m => m.id === msg.id));
});
check('附件写入较小的 UID 一侧且双方各计一次引用', () => {
    const meta = storage.addDMAttachment(A, B, {
        filename: 'pic.png', mime: 'image/png', buffer: PNG, uploader: A,
    });
    assert.ok(fs.existsSync(path.join(paths.dmFilesDir(A, B), meta.id)));
    assert.ok(fs.existsSync(paths.dmFilesIndexPath(A, B)));
    const url = '/messages/file/' + A + '/' + B + '/' + meta.id;
    const msg = storage.appendDM(A, B, '![pic](' + url + ')');
    const got = storage.getDMAttachment(A, B, meta.id);
    assert.ok(got);
    assert.strictEqual(got.refs['u:' + A], 1);
    assert.strictEqual(got.refs['u:' + B], 1);
    assert.ok(storage.getDMAttachmentContent(B, A, meta.id));
    storage.deleteDMMessage(B, A, msg.id);
    const afterB = storage.getDMAttachment(A, B, meta.id);
    assert.ok(afterB, 'B 单侧删除后文件应保留');
    assert.strictEqual(afterB.refs['u:' + A], 1);
    assert.strictEqual(afterB.refs['u:' + B], undefined);
    storage.deleteDMMessage(A, B, msg.id);
    assert.strictEqual(storage.getDMAttachment(A, B, meta.id), null);
    assert.ok(!fs.existsSync(path.join(paths.dmFilesDir(A, B), meta.id)));
});
check('讨论附件按讨论目录保存并随讨论删除', () => {
    const dn = 'attach-test';
    storage.createDomain(dn, '附件测试', A);
    const meta = storage.addDiscussAttachment(dn, 'general', {
        filename: 'note.txt', mime: 'text/plain', buffer: Buffer.from('ok'), uploader: A,
    });
    assert.ok(fs.existsSync(path.join(paths.discussFilesDir(dn, 'general'), meta.id)));
    assert.ok(fs.existsSync(paths.discussFilesIndexPath(dn, 'general')));
    assert.strictEqual(
        storage.getDiscussAttachmentContent(dn, 'general', meta.id).toString('utf8'), 'ok');
    storage.deleteDiscussion(dn, 'general');
    assert.ok(!fs.existsSync(paths.discussFilesDir(dn, 'general')));
});
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

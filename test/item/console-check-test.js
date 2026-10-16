'use strict';
// [回归] check <功能> / check avatar repair
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

const storage = require(path.join(ROOT, 'lib/storage'));
const avatar = require(path.join(ROOT, 'lib/storage/avatar'));
const cmd = require(path.join(ROOT, 'lib/console/commands/check'));

storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();
try { storage.createUser('chk_a', 'pw123456'); } catch (e) {}
try { storage.createUser('chk_b', 'pw123456'); } catch (e) {}
const A = storage.findUserByNickname('chk_a');
const B = storage.findUserByNickname('chk_b');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);

function setExt(uid, ext) {
    const r = storage.loadUser(uid);
    if (ext) r.avatar_ext = ext; else delete r.avatar_ext;
    storage.saveUser(uid, r);
}
function cleanup() {
    for (const u of [A, B]) { avatar.clear(u.id); setExt(u.id, null); }
}

// 屏蔽自检输出
function silence(fn) {
    const orig = console.log;
    const buf = [];
    console.log = (...a) => buf.push(a.join(' '));
    try { fn(); } finally { console.log = orig; }
    return buf.join('\n');
}

check('已注册到 console 的 SINGLE 表', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/console/index.js'), 'utf8');
    assert.ok(/checkCommands\s*=\s*require\('\.\/commands\/check'\)/.test(src), '未 require');
    assert.ok(/check:\s*checkCommands/.test(src), '未注册到 SINGLE');
});

check('每个检查项都有同名导出（dispatch 用 mod[sub] 查找）', () => {
    for (const key of Object.keys(cmd.ITEMS)) {
        assert.strictEqual(typeof cmd[key], 'function', key + ' 未导出为函数');
    }
});

check('检查项覆盖各主要子系统', () => {
    const keys = Object.keys(cmd.ITEMS);
    for (const want of ['user', 'domain', 'discuss', 'dm', 'file', 'avatar', 'perm', 'ip', 'ban', 'json', 'space']) {
        assert.ok(keys.includes(want), '缺少 ' + want);
    }
});

check('每项都能跑通且不抛异常', () => {
    for (const key of Object.keys(cmd.ITEMS)) {
        const out = silence(() => cmd[key]());
        assert.ok(typeof out === 'string', key + ' 无输出');
    }
});

check('未知检查项给出可用列表而非崩溃', () => {
    const out = silence(() => cmd.run(['nosuchthing']));
    assert.ok(/未知检查项/.test(out), out.slice(0, 120));
    assert.ok(/可用/.test(out));
});

check('check 与 check all 等价', () => {
    const a = silence(() => cmd.all());
    const b = silence(() => cmd.run([]));
    assert.strictEqual(a.length > 0 && b.length > 0, true);
    assert.strictEqual(
        (a.match(/通过/g) || []).length,
        (b.match(/通过/g) || []).length,
        'check 与 check all 覆盖的项数不同');
});

check('avatarExtOnDisk 接入 check avatar', () => {
    // 文件是 png、字段写 jpg
    avatar.save(A.id, PNG);
    setExt(A.id, 'jpg');
    const out = silence(() => cmd.avatar([]));
    assert.ok(/格式不一致/.test(out), '未报出不一致:\n' + out);
    assert.ok(/失败/.test(out), '不一致应记为失败');
});

check('avatarExtOnDisk 接入 check avatar：孤儿文件', () => {
    avatar.save(A.id, JPG);
    setExt(A.id, null);
    const out = silence(() => cmd.avatar([]));
    assert.ok(/未登记/.test(out), '未报出孤儿文件:\n' + out);
});

check('avatarExtOnDisk 接入 check avatar：字段指向已删文件', () => {
    avatar.save(A.id, PNG);
    setExt(A.id, 'png');
    fs.rmSync(avatar.avatarPath(A.id, 'png'));   // 文件没了，字段还在
    const out = silence(() => cmd.avatar([]));
    assert.ok(/已丢失/.test(out), '未报出字段悬空:\n' + out);
});

check('check avatar repair 以磁盘为准回填', () => {
    avatar.save(A.id, JPG);      // 磁盘是 jpg
    setExt(A.id, 'png');         // 字段错写成 png
    silence(() => cmd.repairAvatar());
    assert.strictEqual(storage.loadUser(A.id).avatar_ext, 'jpg', '未回填为磁盘上的格式');
});

check('check avatar repair 清理字段悬空', () => {
    avatar.save(A.id, PNG);
    setExt(A.id, 'png');
    fs.rmSync(avatar.avatarPath(A.id, 'png'));   // 文件没了，字段还在
    silence(() => cmd.repairAvatar());
    const r = storage.loadUser(A.id);
    assert.ok(!r.avatar_ext, '字段未清除');
    assert.ok(!fs.existsSync(avatar.avatarPath(A.id, 'png')));
});

check('check avatar repair 幂等', () => {
    avatar.save(A.id, PNG);
    setExt(A.id, 'png');
    silence(() => cmd.repairAvatar());
    const out = silence(() => cmd.repairAvatar());
    assert.ok(/无需修复/.test(out), '二次修复应无事可做:\n' + out);
});

check('check help 列出可用项', () => {
    const out = silence(() => cmd.help());
    assert.ok(/用法/.test(out));
    for (const k of Object.keys(cmd.ITEMS)) assert.ok(out.includes(k), '帮助里缺 ' + k);
});

check('各用户的数据互不干扰', () => {
    avatar.save(A.id, PNG);
    avatar.save(B.id, JPG);
    setExt(A.id, 'png');
    setExt(B.id, 'jpg');
    assert.ok(fs.existsSync(avatar.avatarPath(A.id, 'png')));
    assert.ok(fs.existsSync(avatar.avatarPath(B.id, 'jpg')));
    assert.ok(!fs.existsSync(avatar.avatarPath(A.id, 'jpg')));
    assert.ok(!fs.existsSync(avatar.avatarPath(B.id, 'png')));
});

cleanup();
console.log('\n======== [回归] 控制台自检命令 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter((x) => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
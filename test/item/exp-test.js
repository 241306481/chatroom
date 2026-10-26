const path = require('path');
const assert = require('assert');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
if (fs.existsSync(DATA)) fs.rmSync(DATA, { recursive: true, force: true });
const storage = require('../../lib/storage');
const auth = require('../../lib/auth');
const exp = require('../../lib/auth/exp');
const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };
storage.ensureDirs(); storage.ensureSystemDomain(); storage.ensureSystemUser();
storage.createUser('filler', 'pw123456');
const uid = storage.createUser('expuser', 'pw123456');
auth.grantRole('system', uid, 'default');
const onDisk = () => storage.loadDomain('system').members[uid];
check('addExp 返回前数据已落盘（无任何缓冲）', () => {
    auth.addExp('system', uid, 1);
    assert.strictEqual(onDisk().exp, 1, 'addExp 返回后磁盘上仍是旧值');
});
check('连续 5 次 award，每次都立刻可见', () => {
    for (let i = 2; i <= 5; i++) {
        auth.addExp('system', uid, 1);
        assert.strictEqual(onDisk().exp, i, '第 ' + i + ' 次后磁盘值不是 ' + i);
    }
    assert.strictEqual(onDisk().level, 1, '5 点经验应为 Lv.1');
});
check('跨级 award 立即生效（+5 一次跨两级）', () => {
    auth.addExp('system', uid, 10);
    const m = onDisk();
    assert.strictEqual(m.exp, 15);
    assert.strictEqual(m.level, 2, '15 点应为 Lv.2，实际 ' + m.level);
});
check('源码中不再存在 5 秒定时器/跨请求缓冲', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/auth/exp.js'), 'utf8');
    assert.ok(!/FLUSH_INTERVAL_MS|setTimeout|pending\.set|pending\.get/.test(src),
        '仍存在缓冲或定时器');
    assert.ok(!/const pending = new Map/.test(src), 'pending 缓冲未移除');
});
check('通知在 addExp 调用内同步发出（不延迟 5 秒）', () => {
    const uid2 = storage.createUser('expuser2', 'pw123456');
    auth.grantRole('system', uid2, 'default');
    auth.addExp('system', uid2, 5);
    const msgs = storage.loadAllDM(storage.SYSTEM_UID, uid2);
    assert.ok(msgs.length >= 1, 'addExp 返回后仍没有任何系统通知');
    assert.ok(/升到了 Lv\.1/.test(msgs[msgs.length - 1].content),
        '最后一条通知不是升级消息: ' + msgs[msgs.length - 1].content);
});
check('等级不变时也写盘（低于阈值的经验不丢）', () => {
    const uid3 = storage.createUser('expuser3', 'pw123456');
    auth.grantRole('system', uid3, 'default');
    for (let i = 0; i < 4; i++) auth.addExp('system', uid3, 1);
    assert.strictEqual(storage.loadDomain('system').members[uid3].exp, 4,
        '未到阈值的经验被丢弃');
});
check('存储里不应持久化 ADMIN_LEVEL 哨兵（特权由展示层覆盖）', () => {
    const d = storage.loadDomain('system');
    const members = d.members || {};
    const hasStored99 = Object.keys(members).some(k => members[k].level === 99);
    assert.ok(!hasStored99, '存储中不应存在 level=99 成员');
    const testUid = Object.keys(members)[0];
    auth.addExp('system', testUid, 500);
    const lv = storage.loadDomain('system').members[testUid].level;
    assert.ok(lv >= 5, '经验结算正常，level=' + lv);
});
check('flushExp() 无参调用安全（退出钩子仍会调用）', () => {
    assert.doesNotThrow(() => exp.flushExp());
});
check('非成员 addExp 不抛异常', () => {
    const ghost = storage.createUser('ghost9', 'pw123456');
    assert.doesNotThrow(() => auth.addExp('system', ghost, 5));
});
check('expToLevel 曲线未改变', () => {
    assert.strictEqual(exp.expToLevel(0), 0);
    assert.strictEqual(exp.expToLevel(5), 1);
    assert.strictEqual(exp.expToLevel(15), 2);
    assert.strictEqual(exp.expToLevel(45), 3);
    assert.strictEqual(exp.expToLevel(180), 5);
    assert.strictEqual(exp.expToLevel(430), 6);
});
check('等级封顶在 ADMIN_LEVEL-1，不会撞上特权哨兵', () => {
    assert.strictEqual(auth.expToLevel(23680), 98, '应封顶 98');
    assert.strictEqual(auth.expToLevel(99999999), 98, '超大经验仍封顶 98');
    assert.ok(auth.expToLevel(23680) < 99, '有机等级不可达到 99');
});
const newDn = 'exp-owner-test';
storage.createDomain(newDn, 'owner-test', uid);
check('新建域的域主不存 level=99', () => {
    const m = storage.loadDomain(newDn).members[uid];
    assert.ok(m, '域主应为成员');
    assert.strictEqual(m.level || 0, 0, '域主初始等级应为 0，实际=' + m.level);
});
check('域主也能正常获得经验（死锁已解）', () => {
    const before = storage.loadDomain(newDn).members[uid].exp || 0;
    auth.addExp(newDn, uid, 200);
    const m = storage.loadDomain(newDn).members[uid];
    assert.strictEqual(m.exp, before + 200, '域主经验应正常累加');
    assert.ok(m.level > 0, '域主应能升级，实际 Lv.' + m.level);
});
console.log('\n======== [回归] exp 立即落盘 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

'use strict';
// 回归 封禁时间
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);

const results = [];
const check = async (n, f) => {
    try { await f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

const storage = require(path.join(ROOT, 'lib/storage'));
const { normalizeUntil, isValidUntil, isUntilActive } = require(path.join(ROOT, 'lib/until'));
const bans = require(path.join(ROOT, 'lib/auth/bans'));
const checks = require(path.join(ROOT, 'lib/auth/checks'));
const ipBans = require(path.join(ROOT, 'lib/storage/ip-bans'));

storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();

function mk(nick) {
    try { storage.createUser(nick, 'pw123456'); } catch (e) {}
    return storage.findUserByNickname(nick);
}
// 首个用户是超管
mk('ban_t0');
const u1 = mk('ban_t1');
const u2 = mk('ban_t2');

function userConfigPath(uid) {
    return path.join(ROOT, 'data', 'users', uid, 'config.json');
}
function poke(uid, patch) {
    const p = userConfigPath(uid);
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    Object.assign(raw, patch);
    fs.writeFileSync(p, JSON.stringify(raw, null, 2), 'utf8');
    return storage.loadUser(uid);
}

const domainPath = path.join(ROOT, 'data', 'domains', 'system', 'config.json');
function ensureMember(uid) {
    const d = JSON.parse(fs.readFileSync(domainPath, 'utf8'));
    d.members[uid] = d.members[uid] || { role: 'default', level: 0, exp: 0 };
    fs.writeFileSync(domainPath, JSON.stringify(d, null, 2), 'utf8');
}

(async () => {
    // 校验
    await check('normalizeUntil 拒绝「格式合法但日期不存在」的值', () => {
        for (const bad of ['2099-99-99T99:99', '2026-02-30T12:00', '2024-99-99T12:00', '9999-13-45T00:00:00']) {
            assert.strictEqual(normalizeUntil(bad), null, bad + ' 应被判非法');
        }
    });

    await check('normalizeUntil 接受三种输入形态并统一规范化', () => {
        assert.strictEqual(normalizeUntil('2026-10-14T12:00'), '2026-10-14T12:00:00Z');
        assert.strictEqual(normalizeUntil('2026-10-14T12:00:00'), '2026-10-14T12:00:00Z');
        assert.strictEqual(normalizeUntil('2026-10-14T12:00:00Z'), '2026-10-14T12:00:00Z');
        assert.strictEqual(normalizeUntil(''), '');
        assert.strictEqual(normalizeUntil(null), '');
        assert.strictEqual(normalizeUntil('乱写'), null);
    });

    await check('isValidUntil：空串是合法的「永久」标记', () => {
        assert.strictEqual(isValidUntil(''), true);
        assert.strictEqual(isValidUntil(null), true);
        assert.strictEqual(isValidUntil('2026-10-14T12:00:00Z'), true);
        assert.strictEqual(isValidUntil('2099-99-99T99:99:00Z'), false);
    });

    // 比较
    await check('isUntilActive：字典序比较只在日期真实时成立', () => {
        assert.strictEqual(isUntilActive('', '2026-10-15T00:00:00Z'), true, '永久封禁应生效');
        assert.strictEqual(isUntilActive('2099-12-31T23:59:00Z', '2026-10-15T00:00:00Z'), true);
        assert.strictEqual(isUntilActive('2000-01-01T00:00:00Z', '2026-10-15T00:00:00Z'), false);
    });

    await check('isUntilActive：非法值保守视为生效，不静默解封', () => {
        assert.strictEqual(isUntilActive('2099-99-99T99:99:00Z'), true);
        // 旧实现会悄悄放人
        assert.strictEqual(isUntilActive('2024-99-99T12:00:00Z'), true);
    });

    await check('isUntilActive：历史数据缺秒/缺 Z 的写法也能正确判定', () => {
        assert.strictEqual(isUntilActive('2000-01-01T00:00', '2026-10-15T00:00:00Z'), false);
        assert.strictEqual(isUntilActive('2000-01-01T00:00:00', '2026-10-15T00:00:00Z'), false);
    });

    // 写入路径
    await check('banUserGlobally 拒绝非法 until 且不留下任何写入', () => {
        assert.throws(() => bans.banUserGlobally(u2.id, 'x', '2099-99-99T99:99', '1'));
        const u = storage.loadUser(u2.id);
        assert.ok(!u.banned, '拒绝后不应写入 banned 标记');
    });

    await check('banUserGlobally 写入的是规范化形态', () => {
        bans.banUserGlobally(u2.id, '正常封禁', '2099-12-31T23:59', '1');
        assert.strictEqual(storage.loadUser(u2.id).banned_until, '2099-12-31T23:59:00Z');
        bans.unbanUserGlobally(u2.id);
    });

    await check('banUserInDomain 同样拒绝非法 until', () => {
        assert.throws(() => bans.banUserInDomain('system', u2.id, 'x', '9999-99-99T99:99:00Z', { id: '1' }));
    });

    // 读取路径（核心修复）
    await check('读取端对非法 until 保守判为封禁（旧实现会静默解封）', () => {
        bans.banUserGlobally(u1.id, '注入', '2099-12-31T23:59', '1');
        // 注入脏值
        poke(u1.id, { banned_until: '2024-99-99T12:00:00Z' });
        assert.strictEqual(storage.loadUser(u1.id).banned_until > storage.nowIso(), false,
            '前置条件：裸字符串比较确实会判已过期');
        assert.strictEqual(checks.isUserBanned(storage.loadUser(u1.id)), true,
            '修复后必须仍是封禁状态');
    });

    await check('读取端对未来非法 until 判为封禁（旧实现判永久）', () => {
        poke(u1.id, { banned_until: '2099-99-99T99:99:00Z' });
        assert.strictEqual(checks.isUserBanned(storage.loadUser(u1.id)), true);
    });

    await check('ip-bans 的同源问题：非法 until 不得被当作已过期跳过', () => {
        ipBans.addBan('10.9.9.9', { reason: 'x' });
        const rules = ipBans.listAll();
        rules[0].until = '2999-13-45T00:00:00Z';   // 13 月 45 日
        ipBans.replaceAll(rules);
        assert.ok(ipBans.isBanned('10.9.9.9'), '非法 until 应保守视为仍封禁');
        ipBans.removeByRule('10.9.9.9');
    });

    // 禁言需先在成员表
    ensureMember(u2.id);

    await check('isMuteActive：从未禁言/已解禁的空值必须判为未禁言', () => {
        const { isMuteActive } = require(path.join(ROOT, 'lib/until'));
        // 两种空值都算未禁言
        assert.strictEqual(isMuteActive(undefined), false, 'undefined 应为未禁言');
        assert.strictEqual(isMuteActive(null), false, 'null 应为未禁言');
        assert.strictEqual(isMuteActive(''), false, '空串（解禁后）应为未禁言');
        assert.strictEqual(isMuteActive('2099-12-31T23:59:00Z'), true);
        assert.strictEqual(isMuteActive('2000-01-01T00:00:00Z'), false);
        assert.strictEqual(isMuteActive('2024-99-99T12:00:00Z'), true, '非法值保守判为仍禁言');
    });

    await check('未禁言的普通成员可以正常发言并获得经验', async () => {
        const perms = require(path.join(ROOT, 'lib/auth/perms'));
        const bans2 = require(path.join(ROOT, 'lib/auth/bans'));
        bans2.unbanUserInDomain('system', u1.id);   // 确保在成员表里且未被封禁
        ensureMember(u1.id);
        const du = perms.getDomainUser('system', storage.loadUser(u1.id));
        assert.strictEqual(du.is_muted, false, '未禁言的成员不应被判为禁言');
    });

    await check('muteUser 拒绝非法解禁时间', () => {
        const members = require(path.join(ROOT, 'lib/auth/members'));
        assert.throws(() => members.muteUser('system', u2.id, '2099-99-99T99:99', { id: '1' }));
    });

    await check('禁言读取端：非法解禁时间保守判为仍禁言', () => {
        const members = require(path.join(ROOT, 'lib/auth/members'));
        const perms = require(path.join(ROOT, 'lib/auth/perms'));
        ensureMember(u2.id);
        members.muteUser('system', u2.id, '2099-12-31T23:59', { id: '1' });
        // 注入非法值
        const d2 = JSON.parse(fs.readFileSync(domainPath, 'utf8'));
        d2.members[u2.id].muted_until = '2024-99-99T12:00:00Z';
        fs.writeFileSync(domainPath, JSON.stringify(d2, null, 2), 'utf8');

        const du = perms.getDomainUser('system', storage.loadUser(u2.id));
        assert.strictEqual(du.is_muted, true, '过去的非法日期不得被判为已解禁');
        members.unmuteUser('system', u2.id);
    });

    // 成员列表
    await check('成员列表：已过期的封禁不再被计入、仍生效的被计入', () => {
        const bans2 = require(path.join(ROOT, 'lib/auth/bans'));
        const helpers = require(path.join(ROOT, 'lib/routes/_helpers'));
        bans2.banUserInDomain('system', u2.id, 'x', '2099-12-31T23:59', { id: '1' });
        let list = helpers.buildUserList('system').filter((u) => u.banned);
        assert.strictEqual(list.length, 1, '未到期的封禁应出现在成员列表');
        bans2.unbanUserInDomain('system', u2.id);

        bans2.banUserInDomain('system', u2.id, 'x', '2000-01-01T00:00', { id: '1' });
        list = helpers.buildUserList('system').filter((u) => u.banned);
        assert.strictEqual(list.length, 0, '已过期的封禁不应出现在成员列表');
        bans2.unbanUserInDomain('system', u2.id);
    });

    // 检测与清理
    await check('auditInvalidBans 能查出三类非法数据', () => {
        bans.banUserGlobally(u1.id, '注入', '2099-12-31T23:59', '1');
        poke(u1.id, { banned_until: '2099-99-99T99:99:00Z' });

        const d = storage.loadDomain('system');
        if (!d.bans) d.bans = {};
        d.bans[u2.id] = { reason: 'x', until: '9999-99-99T99:99:00Z', by: '', at: storage.nowIso() };
        storage.saveDomain('system', d);
        d.members[u2.id] = d.members[u2.id] || { role: 'default' };
        d.members[u2.id].muted_until = '2099-13-40T00:00:00Z';
        storage.saveDomain('system', d);

        ipBans.addBan('10.9.9.9');
        const rules = ipBans.listAll();
        rules[0].until = '2999-13-45T00:00:00Z';
        ipBans.replaceAll(rules);

        const bad = bans.auditInvalidBans();
        assert.ok(bad.users.some((x) => x.uid === u1.id), '应查出用户封禁');
        assert.ok(bad.domains.some((x) => x.uid === u2.id), '应查出域内封禁');
        assert.ok(bad.mutes.some((x) => x.uid === u2.id), '应查出禁言');
        assert.strictEqual(bad.ipRules.length, 1, '应查出 IP 规则');
    });

    await check('repairInvalidBans 归一为永久且不解除封禁', () => {
        const fixed = bans.repairInvalidBans();
        assert.strictEqual(fixed.users, 1);
        assert.strictEqual(fixed.domains, 1);
        assert.strictEqual(fixed.mutes, 1);
        assert.strictEqual(fixed.ipRules, 1);
        assert.strictEqual(checks.isUserBanned(storage.loadUser(u1.id)), true, '不应被静默解封');
        assert.strictEqual(storage.loadUser(u1.id).banned_until, '');
        assert.ok(ipBans.isBanned('10.9.9.9'), 'IP 规则应仍生效');
        const d = storage.loadDomain('system');
        assert.strictEqual(d.members[u2.id].muted_until, '', '禁言应归一为永久而非被解除');
    });

    await check('repair 后复查应无残留（修复必须幂等）', () => {
        const bad = bans.auditInvalidBans();
        const n = bad.users.length + bad.domains.length + bad.mutes.length + bad.ipRules.length;
        assert.strictEqual(n, 0, '仍有残留: ' + JSON.stringify(bad));
        const again = bans.repairInvalidBans();
        assert.strictEqual(again.users + again.domains + again.mutes + again.ipRules, 0, '二次修复应无操作');
    });

    await check('控制台 ban audit / ban repair 命令已注册', () => {
        const out = execFileSync(process.execPath,
            [path.join(ROOT, 'lib/console/index.js')],
            { cwd: ROOT, encoding: 'utf8', input: 'ban audit\nexit\n', timeout: 60000 });
        assert.ok(/封禁/.test(out), 'ban audit 应有输出');
        assert.ok(!/未知命令/.test(out), 'ban audit 不应是未知命令');
    });

    // 收尾
    try { bans.unbanUserGlobally(u1.id); } catch (e) {}
    try { bans.unbanUserInDomain('system', u2.id); } catch (e) {}
    try { ipBans.removeByRule('10.9.9.9'); } catch (e) {}

    console.log('\n======== [回归] 封禁时间校验与无效数据治理 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter((x) => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})();

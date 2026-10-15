'use strict';
const storage = require('../../storage');
const { expToLevel, expForNextLevel, addExp } = require('../../auth/exp');
const { C, padR } = require('../ui');

const ADMIN_LEVEL = 99;

function usage(sub) {
    console.log(`${C.red}用法：exp ${sub}${C.reset}`);
}

// 从域成员取经验
function memberOf(dn, uid) {
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域不存在：${dn}${C.reset}`); return null; }
    const m = (d.members || {})[uid];
    if (!m) {
        console.log(`${C.red}${uid} 不是 ${dn} 的成员，无经验记录${C.reset}`);
        return null;
    }
    return m;
}

function show(args) {
    const [uid, dn] = args;
    if (!uid) { usage('show <uid> [domain]  （缺省 domain）'); return; }
    const domain = dn || 'system';
    const m = memberOf(domain, uid);
    if (!m) return;
    const u = storage.loadUser(uid);
    const exp = Number(m.exp || 0);
    const level = Number(m.level || 0);
    const isAdmin = level === ADMIN_LEVEL;

    console.log(`${C.bold}${(u && u.nickname) || uid} (${uid}) @ ${domain}${C.reset}`);
    if (isAdmin) {
        console.log(`  等级：   ${C.yellow}管理员（level=99）${C.reset}`);
        console.log(`  经验：   ${exp}  ${C.gray}（管理员不参与经验结算）${C.reset}`);
        console.log(`  ${C.gray}提示：addExp 对 level=99 直接返回，加经验不会有任何效果${C.reset}`);
        return;
    }
    const cur = level > 1 ? expForNextLevel(level - 1) : 0;
    const next = expForNextLevel(level);
    console.log(`  角色：   ${m.role || '—'}`);
    console.log(`  等级：   Lv.${level}`);
    console.log(`  经验：   ${exp}`);
    if (next > cur) {
        const pct = Math.min(100, Math.max(0, Math.floor(100 * (exp - cur) / (next - cur))));
        const bars = Math.round(pct / 5);
        console.log(`  进度：   ${'█'.repeat(bars)}${'░'.repeat(20 - bars)} ${pct}%  (${cur} ~ ${next})`);
    } else {
        console.log(`  进度：   ${C.gray}已满级${C.reset}`);
    }
}

function add(args) {
    const [uid, delta, dn] = args;
    if (!uid || !delta) { usage('add <uid> <delta> <domain>'); return; }
    const n = parseInt(delta, 10);
    if (!Number.isFinite(n) || n === 0) {
        console.log(`${C.red}delta 必须是非零整数${C.reset}`);
        return;
    }
    if (!dn) { console.log(`${C.red}必须指定域（经验按域存储）${C.reset}`); return; }
    const before = memberOf(dn, uid);
    if (!before) return;

    if (Number(before.level || 0) === ADMIN_LEVEL) {
        console.log(`${C.yellow}⚠ ${uid} 在 ${dn} 的 level=99（管理员），`
            + `addExp 会直接返回，加经验无效${C.reset}`);
        return;
    }
    const bExp = Number(before.exp || 0);
    const bLevel = Number(before.level || 0);
    addExp(dn, uid, n);   // 内部同步落盘，升级时自动发私信

    const after = memberOf(dn, uid);
    const u = storage.loadUser(uid);
    console.log(`${C.green}✔ ${(u && u.nickname) || uid} @ ${dn} 经验 ${n > 0 ? '+' : ''}${n}${C.reset}`);
    console.log(`  Lv.${bLevel} → Lv.${after.level}   经验 ${bExp} → ${Number(after.exp || 0)}`);
    if (Number(after.level) > bLevel) console.log(`${C.yellow}  已升级，升级私信已发出${C.reset}`);
}

function list(args) {
    const dn = args[0] || 'system';
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域不存在：${dn}${C.reset}`); return; }
    const ids = Object.keys(d.members || {});
    if (!ids.length) { console.log(`${C.gray}${dn} 无成员${C.reset}`); return; }
    const rows = ids.map(uid => {
        const u = storage.loadUser(uid) || {};
        const m = d.members[uid] || {};
        return { uid, nickname: u.nickname || '?', role: m.role || '—', exp: Number(m.exp || 0), level: Number(m.level || 0) };
    }).sort((a, b) => b.exp - a.exp);

    console.log(`${C.bold}${dn} 的经验排行（${rows.length} 人）${C.reset}`);
    console.log(`${C.gray}${'─'.repeat(64)}${C.reset}`);
    console.log('  ' + padR('UID', 8) + padR('昵称', 22) + padR('角色', 12) + padR('等级', 10) + '经验');
    for (const r of rows) {
        const lv = r.level === ADMIN_LEVEL ? `${C.yellow}管理员${C.reset}` : 'Lv.' + r.level;
        console.log('  ' + padR(r.uid, 8) + padR(storage.sliceChars(r.nickname, 20), 22)
            + padR(r.role, 12) + padR(String(r.level === ADMIN_LEVEL ? '99' : lv), 10) + String(r.exp));
    }
}

module.exports = { show, add, list };
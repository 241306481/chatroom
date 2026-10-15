'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');
const { isOwnerOfAnyDomain } = require('./checks');
const { normalizeUntil } = require('../until');

const UNTIL_HINT = '解封时间无效，应为 2026-06-01T12:00 或 2026-06-01T12:00:00Z';

// 写入路径必须自己设防：此前只有路由调用方做校验，任何新调用方（或历史数据、
// 手工编辑）绕过它就会把非法值落库，而读取端是字典序比较，2099-99-99
// 这类值会被判成永久封禁。
function requireUntil(raw) {
    const u = normalizeUntil(raw);
    if (u === null) throw new Error(UNTIL_HINT);
    return u;
}

// 全局封禁
function banUserGlobally(targetUid, reason, untilIso, byUid) {
    const target = storage.loadUser(targetUid);
    if (!target.id) throw new Error('用户不存在');
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
        throw new Error('不能封禁超级管理员');
    }
    const actorUser = byUid ? storage.loadUser(byUid) : null;
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL)
        && !(actorUser && hasPriv(actorUser, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        throw new Error('系统管理员不能被系统管理员封禁');
    }
    target.banned = true;
    target.ban_reason = storage.sliceChars(reason, 200);
    target.banned_until = requireUntil(untilIso);
    target.banned_by = byUid;
    target.banned_at = storage.nowIso();
    storage.saveUser(targetUid, target);
}

function unbanUserGlobally(targetUid) {
    const target = storage.loadUser(targetUid);
    if (!target.id) throw new Error('用户不存在');
    delete target.banned;
    delete target.ban_reason;
    delete target.banned_until;
    delete target.banned_by;
    delete target.banned_at;
    storage.saveUser(targetUid, target);
}

// 系统管理员
function setSystemRole(targetUid, roleName) {
    const target = storage.loadUser(targetUid);
    if (!target.id) throw new Error('用户不存在');
    if (target.is_system) throw new Error('不能修改系统账户');

    const sysRoles = require('../storage/system-roles');
    if (!sysRoles.roleExists(roleName)) throw new Error('角色不存在');

    // 不能把普通用户升级为 root
    if (roleName === 'root' && target.system_role !== 'root') {
        throw new Error('不能把用户升级为超级管理员');
    }

    // 不能降级 root
    if (target.system_role === 'root' && roleName !== 'root') {
        throw new Error('超级管理员不可被降级');
    }

    target.system_role = roleName;
    storage.saveUser(targetUid, target);
}

// 域封禁
function banUserInDomain(dn, targetUid, reason, untilIso, actor) {
    const domain = storage.loadDomain(dn);
    if (!domain.name) throw new Error('域不存在');
    if (domain.owner_id === targetUid) throw new Error('不能封禁所有者');

    const target = storage.loadUser(targetUid);
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
        throw new Error('不能封禁超级管理员');
    }
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL)
        && !(actor && hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        throw new Error('系统管理员不能被系统管理员封禁');
    }

    // 目标若是该域其他管理员
    const targetMember = domain.members && domain.members[targetUid];
    if (targetMember && targetMember.role === 'root') {
        if (!actor || domain.owner_id !== actor.id) {
            throw new Error('只有所有者能封禁管理员');
        }
    }

    // 目标若是其他域的所有者
    if (isOwnerOfAnyDomain(targetUid)
        && (!actor || !hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL))) {
        throw new Error('该用户是某个域的所有者');
    }

    if (!domain.bans) domain.bans = {};
    domain.bans[targetUid] = {
        reason: storage.sliceChars(reason, 200),
        until: requireUntil(untilIso),
        by: (actor && actor.id) || '',
        at: storage.nowIso(),
    };
    if (domain.members && domain.members[targetUid]) {
        delete domain.members[targetUid];
    }
    storage.saveDomain(dn, domain);
}

function unbanUserInDomain(dn, targetUid) {
    const domain = storage.loadDomain(dn);
    if (!domain.bans || !domain.bans[targetUid]) return;
    delete domain.bans[targetUid];
    storage.saveDomain(dn, domain);
}

// ============================================================
// 无效封禁数据：检测与清理
// ============================================================
// 封禁是否生效靠字典序比较，2099-99-99 这类「形状合法但日期不存在」的值会被
// 判成永久。写入路径现已强制校验，但历史数据、手工编辑、磁盘损坏仍可能留下
// 这种值——读取端只能保守视为生效（isUntilActive），所以必须能查出来并修掉。

// 只读扫描：返回所有 until 非法的封禁与禁言记录
function auditInvalidBans() {
    const { isValidUntil } = require('../until');
    const bad = { users: [], domains: [], mutes: [], ipRules: [] };

    for (const u of storage.listRealUsers()) {
        // 只看 banned：banned_until 在 unban 时会被 delete，残留脏值本身无害，
        // 但若 banned 标记在而 until 非法，那就是真正会被误判的记录。
        if (!u.banned) continue;
        if (isValidUntil(u.banned_until)) continue;
        bad.users.push({ uid: u.id, nickname: u.nickname || '', until: u.banned_until });
    }

    for (const dn of storage.listAllDomains()) {
        const d = storage.loadDomain(dn);
        if (!d.name) continue;
        if (d.bans) {
            for (const [uid, b] of Object.entries(d.bans)) {
                if (!b || isValidUntil(b.until)) continue;
                bad.domains.push({ domain: dn, uid, until: b.until });
            }
        }
        // 禁言与封禁同源：靠字典序比较判定，非法值会被误判成永久禁言
        if (d.members) {
            for (const [uid, m] of Object.entries(d.members)) {
                if (!m || !m.muted_until || isValidUntil(m.muted_until)) continue;
                bad.mutes.push({ domain: dn, uid, until: m.muted_until });
            }
        }
    }

    const ipBans = require('../storage/ip-bans');
    for (const r of ipBans.listAll()) {
        if (isValidUntil(r.until)) continue;
        bad.ipRules.push({ rule: r.rule, until: r.until });
    }

    return bad;
}

// 把非法 until 归一为「永久」（''），与读取端的保守判定保持一致：
// 保留封禁本身，只把不可解释的值换成管理员随后能在界面上改的合法值。
// 不删除封禁记录——悄悄解封是安全回退。
function repairInvalidBans() {
    const bad = auditInvalidBans();
    const fixed = { users: 0, domains: 0, mutes: 0, ipRules: 0 };

    for (const b of bad.users) {
        const u = storage.loadUser(b.uid);
        if (!u.id) continue;
        u.banned_until = '';
        storage.saveUser(b.uid, u);
        fixed.users++;
    }

    // 域内封禁与禁言要合并成一次写盘，否则同一域会保存两次。
    // 注意必须缓存域对象：每次 loadDomain 都返回新副本，改在临时对象上会全部丢失。
    const domains = new Map();
    const domainOf = (dn) => {
        if (!domains.has(dn)) domains.set(dn, storage.loadDomain(dn));
        return domains.get(dn);
    };

    for (const b of bad.domains) {
        const d = domainOf(b.domain);
        if (!d.name || !d.bans || !d.bans[b.uid]) continue;
        d.bans[b.uid].until = '';
        fixed.domains++;
    }
    for (const b of bad.mutes) {
        const d = domainOf(b.domain);
        if (!d.name || !d.members || !d.members[b.uid]) continue;
        d.members[b.uid].muted_until = '';
        fixed.mutes++;
    }
    for (const [dn, d] of domains) {
        if (d.name) storage.saveDomain(dn, d);
    }

    if (bad.ipRules.length) {
        const ipBans = require('../storage/ip-bans');
        const rules = ipBans.listAll();
        const badSet = new Set(bad.ipRules.map((b) => b.rule));
        for (const r of rules) if (badSet.has(r.rule)) r.until = '';
        ipBans.replaceAll(rules);
        fixed.ipRules = bad.ipRules.length;
    }

    try {
        require('../logger').warn(
            '已修复无效时间数据：封禁', fixed.users, '域内封禁', fixed.domains,
            '禁言', fixed.mutes, 'IP 规则', fixed.ipRules,
            '（非法值已归一为永久，请在管理页确认是否需要设置解禁时间）');
    } catch (e) {}

    return fixed;
}

module.exports = {
    normalizeUntil,
    banUserGlobally, unbanUserGlobally,
    setSystemRole,
    banUserInDomain, unbanUserInDomain,
    auditInvalidBans, repairInvalidBans,
};
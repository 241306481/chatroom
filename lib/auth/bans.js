'use strict';
const storage = require('../storage');
const { PRIV, hasPriv } = require('../permissions');
const { isOwnerOfAnyDomain } = require('./checks');
const { sendSystemDM } = require('./system-dm');

// ============================================================
// 到期时间校验（全站唯一实现）
// ============================================================
// isUserBanned / isUserBannedInDomain 都是拿 until 与 nowIso() 做**字典序比较**，
// 因此 until 必须同时满足两件事：
//   1. 是合法的 ISO 时刻 —— 只做正则匹配是不够的。`2099-99-99T99:99:99`、
//      `2024-02-30T00:00:00` 这类值正则完全合法，字典序又远大于 now，
//      于是封禁会静默变成「几千年后解禁」= 永久封禁，管理员毫不知情。
//      反过来，过去的非法日期（如 2024-99-99）会让封禁立刻失效。
//   2. 统一带 Z 后缀 —— 少一个字符就会在字典序比较里整体偏小一位。
// 返回值：'' 表示永久（调用方显式留空）；null 表示非法，调用方必须报错回退，
// 绝不能退化成 ''（空串恰好就是「永久」）。
function normalizeUntil(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    // 接受三种形态，统一规范化为「秒 + Z」：
    //   2026-10-14T12:00        ← <input type="datetime-local"> 的原生取值（无秒、无时区）
    //   2026-10-14T12:00:00
    //   以上两者带 Z
    // 秒不可省：很多管理页（含本项目）直接用 datetime-local，
    // 它的 value 格式就是不带秒的，而朴素的 %H:%M:%S 正则会把它判为非法，
    // 管理员填了时间却得到「格式无效」，或（更糟）被静默当成永久封禁。
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?Z?$/.exec(s);
    if (!m) return null;
    // 不带 Z 的时间戳按 UTC 解释。直接 Date.parse 会按**服务器本地时区**解析，
    // 再拿 UTC 渲染结果做往返比对，在非 UTC 服务器（如 Asia/Shanghai）上
    // 会把完全合法的时间戳判成无效。
    const iso = m[1] + 'T' + m[2] + ':' + (m[3] || '00') + 'Z';
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    // 拒绝 2024-02-30 这类「格式对但日期不存在」的值
    if (new Date(t).toISOString().slice(0, 19) !== iso.slice(0, 19)) return null;
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ============================================================
// 全局封禁
// ============================================================
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
    target.banned_until = untilIso || '';
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

// ============================================================
// 系统管理员
// ============================================================
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

// ============================================================
// 域封禁
// ============================================================
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
        until: untilIso || '',
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

module.exports = {
    normalizeUntil,
    banUserGlobally, unbanUserGlobally,
    setSystemRole,
    banUserInDomain, unbanUserInDomain,
};
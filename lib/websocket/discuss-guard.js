'use strict';
// 入站 WebSocket 消息的权限闸门。
//
// 从 discuss.js 抽出：这些判定与消息处理逻辑无关，且是权限 kill-switch
// 回归的重点，单独成文件后改动的影响面一目了然。
const auth = require('../auth');
const { PERM, PRIV, DUAL_CHECK, hasPriv, hasPrivAny, hasPerm, expandPerm } = require('../permissions');

function parseMentions(content, dn, senderUser, du) {
    const regex = /@(@?)\[(\d+)\]/g;
    const mentions = [];
    const silent = [];
    const seen = new Set();
    let m;
    const isSilent = (uid) => {
        if (m[1] === '@') return true;
        if (uid === senderUser.id) return true;
        if (!hasPerm(du.perm, PERM.MENTION_MEMBER)) return true;
        const domain = storage.loadDomain(dn);
        const isMember = domain.members && domain.members[uid];
        if (!isMember) {
            if (!hasPriv(senderUser, 'base', PRIV.BASE.MENTION_GLOBAL)) return true;
        }
        const u = storage.loadUser(uid);
        if (!u.id || u.is_system) return true;
        return false;
    };
    while ((m = regex.exec(content)) !== null) {
        const uid = m[2];
        if (seen.has(uid)) continue;
        seen.add(uid);
        if (isSilent(uid)) silent.push(uid);
        else mentions.push(uid);
    }
    return { mentions, silent };
}

// WebSocket 内联双检：返回 { ok, msg }
// isOwn 与 checkDual 语义一致：区分 own/any 的操作必须显式传入归属
// 与 lib/auth/privilege.js 的 skipPrivFor 保持完全一致：
// 只有 domain 组对特权用户豁免全局 PRIV 位。
// 早期这里对所有组豁免，导致管理员在 /manage/permissions 关掉
// message.pin 之后，域内管理员仍然能通过 WebSocket 置顶 ——
// 全局关闭开关静默失效，且 HTTP 与 WS 两条路径行为不一致。
const PRIV_EXEMPT_GROUPS = new Set(['domain']);

function dualCheckWs(user, du, opKey, isOwn) {
    const conf = DUAL_CHECK[opKey];
    if (!conf) return { ok: false, msg: '未知权限检查项' };

    const skipPriv = !!(du && du.is_privileged)
        && PRIV_EXEMPT_GROUPS.has(conf.priv && conf.priv.group);

    if (conf.privOwn || conf.permOwn) {
        if (!conf.priv || !conf.permOwn || !conf.privOwn) {
            return { ok: false, msg: '权限检查项配置不完整' };
        }
        const exp = expandPerm(du.perm || 0);
        if (isOwn === true) {
            // 自己的目标：OWN 位或 ANY 位均可满足（ANY 蕴含 OWN）
            if (!skipPriv
                && !hasPrivAny(user, conf.priv.group, conf.privOwn.bit | conf.priv.bit)) {
                return { ok: false, msg: '系统禁用了「' + (conf.label || opKey) + '」权限' };
            }
            if ((exp & (conf.permOwn | conf.perm)) === 0) {
                return { ok: false, msg: '你没有「' + (conf.label || opKey) + '」的域内权限' };
            }
        } else {
            // 他人的目标：必须持有 ANY 位
            if (!skipPriv && !hasPriv(user, conf.priv.group, conf.priv.bit)) {
                return { ok: false, msg: '系统禁用了「' + (conf.label || opKey) + '」权限' };
            }
            if ((exp & conf.perm) === 0) {
                return { ok: false, msg: '你没有「' + (conf.label || opKey) + '」的域内权限' };
            }
        }
        return { ok: true };
    }

    if (!skipPriv && !hasPrivAny(user, conf.priv.group, conf.priv.bit)) {
        return { ok: false, msg: '系统禁用了「' + (conf.label || opKey) + '」权限' };
    }
    const expanded = expandPerm(du.perm || 0);
    if ((expanded & conf.perm) === 0) {
        return { ok: false, msg: '你没有「' + (conf.label || opKey) + '」的域内权限' };
    }
    return { ok: true };
}

module.exports = { parseMentions, dualCheckWs, PRIV_EXEMPT_GROUPS };

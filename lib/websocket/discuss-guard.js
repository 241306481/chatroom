'use strict';
const auth = require('../auth');
const { PERM, PRIV, DUAL_CHECK, hasPriv, hasPrivAny, hasPerm, expandPerm, bits } = require('../permissions');
function parseMentions(content, dn, senderUser, du) {
    const regex = /@(@?)\[(\d+)\]/g;
    const mentions = [];
    const silent = [];
    const seen = new Set();
    let m;
    const isSilent = (uid) => {
        if (m[1] === '@') return true;
        if (uid === senderUser.id) return true;
        if (!hasPerm(du.perm, PERM.MESSAGE.MENTION_MEMBER)) return true;
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
function dualCheckWs(user, du, opKey, isOwn) {
    const conf = DUAL_CHECK[opKey];
    if (!conf) return { ok: false, msg: '未知权限检查项' };
    if (conf.privOwn || conf.permOwn) {
        if (!conf.priv || !conf.permOwn || !conf.privOwn) {
            return { ok: false, msg: '权限检查项配置不完整' };
        }
        const exp = expandPerm(du.perm || 0);
        if (isOwn === true) {
            if (!hasPrivAny(user, conf.priv.group, conf.privOwn.bit | conf.priv.bit)) {
                return { ok: false, msg: '系统禁用了「' + (conf.label || opKey) + '」权限' };
            }
            if (!bits.hasAny(exp, bits.or(conf.permOwn, conf.perm))) {
                return { ok: false, msg: '你没有「' + (conf.label || opKey) + '」的域内权限' };
            }
        } else {
            if (!hasPriv(user, conf.priv.group, conf.priv.bit)) {
                return { ok: false, msg: '系统禁用了「' + (conf.label || opKey) + '」权限' };
            }
            if (!bits.has(exp, conf.perm)) {
                return { ok: false, msg: '你没有「' + (conf.label || opKey) + '」的域内权限' };
            }
        }
        return { ok: true };
    }
    if (!hasPrivAny(user, conf.priv.group, conf.priv.bit)) {
        return { ok: false, msg: '系统禁用了「' + (conf.label || opKey) + '」权限' };
    }
    const expanded = expandPerm(du.perm || 0);
    if (!bits.has(expanded, conf.perm)) {
        return { ok: false, msg: '你没有「' + (conf.label || opKey) + '」的域内权限' };
    }
    return { ok: true };
}
module.exports = { parseMentions, dualCheckWs };

'use strict';
const { PERM, hasPriv, hasPrivAny, hasPerm, expandPerm, DUAL_CHECK, bits } = require('../permissions');
class PrivilegeError extends Error {
    constructor(message, status) {
        super(message || '权限不足');
        this.name = 'PrivilegeError';
        this.status = status || 403;
    }
}
class UnauthorizedError extends PrivilegeError {
    constructor(message) {
        super(message || '请先登录', 401);
        this.name = 'UnauthorizedError';
    }
}
function checkPriv(user, group, bit) {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!hasPriv(user, group, bit)) throw new PrivilegeError();
}
function checkPerm(domainUser, perm) {
    if (!domainUser || !hasPerm(domainUser.perm || 0, perm)) {
        throw new PrivilegeError();
    }
}
function checkDual(user, domainUser, opKey, isOwn) {
    const conf = DUAL_CHECK[opKey];
    if (!conf) throw new PrivilegeError('未知权限检查项：' + opKey);
    if (!user || !user.id) throw new UnauthorizedError();
    if (conf.privOwn || conf.permOwn) {
        if (!conf.priv || !conf.permOwn || !conf.privOwn) {
            throw new PrivilegeError('权限检查项配置不完整：' + opKey);
        }
        const expanded = expandPerm(domainUser ? domainUser.perm || 0 : 0);
        if (isOwn === true) {
            if (!hasPrivAny(user, conf.priv.group, conf.privOwn.bit | conf.priv.bit)) {
                throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
            }
            if (!bits.hasAny(expanded, bits.or(conf.permOwn, conf.perm))) {
                throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
            }
        } else {
            if (!hasPriv(user, conf.priv.group, conf.priv.bit)) {
                throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
            }
            if (!bits.has(expanded, conf.perm)) {
                throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
            }
        }
        return;
    }
    if (!hasPrivAny(user, conf.priv.group, conf.priv.bit)) {
        throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
    }
    const expanded = expandPerm(domainUser ? domainUser.perm || 0 : 0);
    if (!bits.has(expanded, conf.perm)) {
        throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
    }
}
module.exports = {
    PrivilegeError, UnauthorizedError,
checkPriv,
    checkPerm,
    checkDual,
};

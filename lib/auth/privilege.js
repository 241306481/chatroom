'use strict';
const { DUAL_CHECK, PRIV, PERM, hasPriv, hasPerm, expandPerm } = require('../permissions');

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

function checkPriv(user, priv) {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!hasPriv(user.priv || 0, priv)) throw new PrivilegeError();
}

function checkPerm(domainUser, perm) {
    if (!domainUser || !hasPerm(domainUser.perm || 0, perm)) {
        throw new PrivilegeError();
    }
}

/**
 * 双检：PRIV 和 PERM 同时满足才通过
 * @param {object} user      - 当前用户（可能为 null）
 * @param {object} domainUser - getDomainUser 的返回值
 * @param {string} opKey     - DUAL_CHECK 的 key（如 'send_message'）
 * @throws {UnauthorizedError} 未登录
 * @throws {PrivilegeError}    PRIV 或 PERM 不满足
 */
function checkDual(user, domainUser, opKey) {
    const conf = DUAL_CHECK[opKey];
    if (!conf) throw new PrivilegeError('未知权限检查项：' + opKey);

    // 未登录 → 401
    if (!user || !user.id) throw new UnauthorizedError();

    // 检查 PRIV
    if (!hasPriv(user.priv || 0, conf.priv)) {
        throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
    }

    // 检查 PERM（支持 OR 语义：perm 是掩码，命中任一即可）
    const expanded = expandPerm(domainUser ? domainUser.perm || 0 : 0);
    if ((expanded & conf.perm) === 0) {
        throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
    }
}

module.exports = { PrivilegeError, UnauthorizedError, checkPriv, checkPerm, checkDual };

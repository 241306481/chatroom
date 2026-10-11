'use strict';
const { PERM, hasPriv, hasPrivAny, hasPerm, expandPerm, DUAL_CHECK } = require('../permissions');

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

/**
 * 检查全局特权（单组）
 * @param {object} user  - 当前用户（有 privs 对象）
 * @param {string} group - 'base' / 'system' / 'discuss' / 'message' / 'file' / 'member' / 'domain'
 * @param {number} bit   - PRIV.<GROUP>.<XXX>
 */
function checkPriv(user, group, bit) {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!hasPriv(user, group, bit)) throw new PrivilegeError();
}

/**
 * 兼容旧签名 checkPriv(user, { group, bit })
 * 也支持 checkPriv(user, group, bit)
 */
function checkPrivCompat(user, groupOrObj, maybeBit) {
    if (groupOrObj && typeof groupOrObj === 'object' && 'group' in groupOrObj) {
        return checkPriv(user, groupOrObj.group, groupOrObj.bit);
    }
    return checkPriv(user, groupOrObj, maybeBit);
}

function checkPerm(domainUser, perm) {
    if (!domainUser || !hasPerm(domainUser.perm || 0, perm)) {
        throw new PrivilegeError();
    }
}

/**
 * 双检：PRIV 和 PERM 同时满足
 * DUAL_CHECK[opKey].priv = { group, bit }
 * @param {object} user       - 当前用户（可能为 null）
 * @param {object} domainUser - getDomainUser 的返回值
 * @param {string} opKey      - DUAL_CHECK 的 key（如 'send_message'）
 * @throws {UnauthorizedError} 未登录
 * @throws {PrivilegeError}    PRIV 或 PERM 不满足
 */
function checkDual(user, domainUser, opKey) {
    const conf = DUAL_CHECK[opKey];
    if (!conf) throw new PrivilegeError('未知权限检查项：' + opKey);

    // 未登录 → 401
    if (!user || !user.id) throw new UnauthorizedError();

    // 检查 PRIV（组 + 位掩码，支持 OR）
    if (!hasPrivAny(user, conf.priv.group, conf.priv.bit)) {
        throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
    }

    // 检查 PERM（支持 OR 语义：perm 是掩码，命中任一即可）
    const expanded = expandPerm(domainUser ? domainUser.perm || 0 : 0);
    if ((expanded & conf.perm) === 0) {
        throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
    }
}

module.exports = {
    PrivilegeError, UnauthorizedError,
    checkPriv: checkPrivCompat,
    checkPrivCompat,
    checkPerm,
    checkDual,
};
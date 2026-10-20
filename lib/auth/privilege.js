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
 * @param {boolean} [isOwn]   - 目标是否属于当前用户。
 *                               对 delete_message / revoke_message / delete_file
 *                               这类区分 own/any 的操作，必须显式传入，
 *                               否则按 ANY 强度校验（最严格）。
 * @throws {UnauthorizedError} 未登录
 * @throws {PrivilegeError}    PRIV 或 PERM 不满足
 */
function checkDual(user, domainUser, opKey, isOwn) {
    const conf = DUAL_CHECK[opKey];
    if (!conf) throw new PrivilegeError('未知权限检查项：' + opKey);

    // 未登录 → 401
    if (!user || !user.id) throw new UnauthorizedError();

    // 按归属校验
    if (conf.privOwn || conf.permOwn) {
        if (!conf.priv || !conf.permOwn || !conf.privOwn) {
            throw new PrivilegeError('权限检查项配置不完整：' + opKey);
        }
        const expanded = expandPerm(domainUser ? domainUser.perm || 0 : 0);
        if (isOwn === true) {
            // 自己 OWN/ANY
            if (!hasPrivAny(user, conf.priv.group, conf.privOwn.bit | conf.priv.bit)) {
                throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
            }
            if (!bits.hasAny(expanded, bits.or(conf.permOwn, conf.perm))) {
                throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
            }
        } else {
            // 他人：须 ANY
            if (!hasPriv(user, conf.priv.group, conf.priv.bit)) {
                throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
            }
            if (!bits.has(expanded, conf.perm)) {
                throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
            }
        }
        return;
    }

    // 检查 PRIV
    if (!hasPrivAny(user, conf.priv.group, conf.priv.bit)) {
        throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
    }

    // 检查 PERM
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
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

// 只有「域设置」这一组豁免全局 PRIV 检查，其余组一律照常校验
const PRIV_EXEMPT_GROUPS = new Set(['domain']);

function skipPrivFor(conf, domainUser) {
    if (!domainUser || !domainUser.is_privileged) return false;
    const g = conf && conf.priv && conf.priv.group;
    return PRIV_EXEMPT_GROUPS.has(g);
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

    // 见 skipPrivFor：只有 domain 组对特权用户豁免全局 PRIV 位。
    const skipPriv = skipPrivFor(conf, domainUser);

    // own/any 分离的操作：按目标归属选择校验强度
    if (conf.privOwn || conf.permOwn) {
        if (!conf.priv || !conf.permOwn || !conf.privOwn) {
            throw new PrivilegeError('权限检查项配置不完整：' + opKey);
        }
        const expanded = expandPerm(domainUser ? domainUser.perm || 0 : 0);
        if (isOwn === true) {
            // 自己的目标：OWN 位或 ANY 位均可满足（ANY 蕴含 OWN）
            if (!skipPriv
                && !hasPrivAny(user, conf.priv.group, conf.privOwn.bit | conf.priv.bit)) {
                throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
            }
            if ((expanded & (conf.permOwn | conf.perm)) === 0) {
                throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
            }
        } else {
            // 他人的目标：必须持有 ANY 位
            if (!skipPriv && !hasPriv(user, conf.priv.group, conf.priv.bit)) {
                throw new PrivilegeError('系统禁用了「' + (conf.label || opKey) + '」权限');
            }
            if ((expanded & conf.perm) === 0) {
                throw new PrivilegeError('你没有「' + (conf.label || opKey) + '」的域内权限');
            }
        }
        return;
    }

    // 检查 PRIV（组 + 位掩码，支持 OR）
    if (!skipPriv && !hasPrivAny(user, conf.priv.group, conf.priv.bit)) {
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
'use strict';
const { hasPriv, hasPerm } = require('../permissions');

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

module.exports = { PrivilegeError, UnauthorizedError, checkPriv, checkPerm };

'use strict';
const { PRIV, hasPriv } = require('../../permissions');
const { UnauthorizedError } = require('../../auth/privilege');
const { render403 } = require('../../template');

function requireSystemAdmin(user, res) {
    if (!user || !user.id) {
        throw new UnauthorizedError();
    }
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        render403(res, '仅系统管理员可访问');
        return false;
    }
    return true;
}

module.exports = { requireSystemAdmin };
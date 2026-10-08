'use strict';
const storage = require('../storage');

/**
 * 以系统身份向用户发送私信（不抛异常，静默处理）
 */
function sendSystemDM(toUid, content) {
    const sysUser = storage.loadUser(storage.SYSTEM_UID);
    if (!sysUser || !sysUser.id) return null;
    if (toUid === storage.SYSTEM_UID) return null;
    return storage.appendDM(storage.SYSTEM_UID, toUid, content, { is_system: true });
}

module.exports = { sendSystemDM };
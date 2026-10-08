'use strict';
const storage = require('../storage');

/**
 * 以系统身份向用户发送私信（写入 + WebSocket 推送）
 * 不抛异常，静默处理
 */
function sendSystemDM(toUid, content) {
    const sysUser = storage.loadUser(storage.SYSTEM_UID);
    if (!sysUser || !sysUser.id) return null;
    if (toUid === storage.SYSTEM_UID) return null;

    let msg;
    try {
        msg = storage.appendDM(storage.SYSTEM_UID, toUid, content, { is_system: true });
    } catch (e) {
        return null;
    }

    // 延迟 require 避免循环依赖（websocket/index.js 引用了 storage 和 auth）
    try {
        const registry = require('../websocket/registry');
        registry.dmSend(toUid, {
            type: 'dm_new',
            message: {
                id: msg.id,
                from: storage.SYSTEM_UID,
                to: toUid,
                from_nickname: sysUser.nickname || 'System',
                from_avatar_color: sysUser.avatar_color || '#1890ff',
                content: msg.content,
                created_at: msg.created_at,
                is_system: true,
            },
        });
    } catch (e) {
        // 推送失败不影响写入，忽略
    }

    return msg;
}

module.exports = { sendSystemDM };

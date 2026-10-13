'use strict';
const storage = require('../storage');
const auth = require('../auth');
const logger = require('../logger');
const registry = require('./registry');
const { PRIV, hasPriv } = require('../permissions');

// ============================================================
// 消息处理
// ============================================================
function handleMessage(ws, snapshotUser, data) {
    // 每条消息重读用户：握手快照不会反映连接期间发生的封禁/角色变更
    const fresh = storage.loadUser(snapshotUser.id);
    const user = (fresh && fresh.id) ? fresh : snapshotUser;
    if (auth.isUserBanned(user)) {
        try { ws.send(JSON.stringify({ type: 'error', msg: '账号已被封禁' })); } catch (e) {}
        try { ws.close(4003, 'banned'); } catch (e) {}
        return;
    }
    // 全局「发送私信」开关同样要在连接期间生效
    if (!hasPriv(user, 'base', PRIV.BASE.SEND_DM)) {
        try { ws.send(JSON.stringify({ type: 'error', msg: '系统已禁用私信功能' })); } catch (e) {}
        return;
    }

    if (data.type === 'dm_send') {
        const target = String(data.target || '');
        const content = storage.sliceChars(data.content, 8000);
        if (!target || !content) return;

        // 先做权限检查，给出友好提示
        const check = storage.canSendDM(user.id, target);
        if (!check.ok) {
            ws.send(JSON.stringify({ type: 'error', msg: check.error }));
            return;
        }

        // appendDM 内部再做一次兜底校验
        let msg;
        try { msg = storage.appendDM(user.id, target, content); }
        catch (e) {
            ws.send(JSON.stringify({ type: 'error', msg: e.message }));
            return;
        }

        registry.dmSend(target, {
            type: 'dm_new',
            message: {
                id: msg.id, from: user.id, to: target,
                from_nickname: user.nickname,
                from_avatar_color: user.avatar_color || '#888',
                content: msg.content, created_at: msg.created_at,
            },
        });
        registry.dmSend(user.id, {
            type: 'dm_sent',
            message: {
                id: msg.id, from: user.id, to: target,
                from_nickname: user.nickname,
                from_avatar_color: user.avatar_color || '#888',
                content: msg.content, created_at: msg.created_at,
            },
        });
        return;
    }

    if (data.type === 'dm_read') {
        const target = String(data.target || '');
        if (target) storage.markDMRead(user.id, target);
    }

    if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
}

// ============================================================
// 连接处理
// ============================================================
function onConnect(ws, { user, ip }) {
    ws._ip = ip;
    ws._uid = user.id;
    registry.registerDm(user.id, ws);
    logger.wsConn(ip, 'dm', user.nickname, user.id, '');

    ws.on('message', raw => {
        let data; try { data = JSON.parse(raw.toString()); } catch (e) { return; }
        handleMessage(ws, user, data);
    });

    ws.on('close', () => {
        registry.unregisterDm(user.id, ws);
        logger.wsClose(ip, 'dm', user.nickname, user.id, '');
    });
}

module.exports = { onConnect };
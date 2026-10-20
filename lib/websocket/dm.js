'use strict';
const storage = require('../storage');
const auth = require('../auth');
const logger = require('../logger');
const registry = require('./registry');
const { PRIV, hasPriv } = require('../permissions');

// 消息处理
function handleMessage(ws, snapshotUser, data) {
    // 每条重读用户
    const fresh = storage.loadUser(snapshotUser.id);
    const user = (fresh && fresh.id) ? fresh : snapshotUser;
    // 逐消息查 IP 封禁
    if (ws._ip && storage.isIpBanned(ws._ip)) {
        try { ws.send(JSON.stringify({ type: 'error', msg: '你的 IP 已被封禁' })); } catch (e) {}
        try { ws.close(4003, 'ip-banned'); } catch (e) {}
        return;
    }
    if (auth.isUserBanned(user)) {
        try { ws.send(JSON.stringify({ type: 'error', msg: '账号已被封禁' })); } catch (e) {}
        try { ws.close(4003, 'banned'); } catch (e) {}
        return;
    }
    // 私信开关逐条查
    if (!hasPriv(user, 'base', PRIV.BASE.SEND_DM)) {
        try { ws.send(JSON.stringify({ type: 'error', msg: '系统已禁用私信功能' })); } catch (e) {}
        return;
    }

    if (data.type === 'dm_send') {
        const target = String(data.target || '');
        const content = storage.sliceChars(data.content, 8000);
        if (!target || !content) return;

        // 限流按 uid 计数：cookie 被搬到别的 IP 也逃不掉
        const limiter = require('../rate-limit');
        const limited = limiter.check('dm_send', {
            ip: ws._ip || '',
            account: user.id,
        });
        if (limited) {
            ws.send(JSON.stringify({
                type: 'error',
                msg: '私信过于频繁，请 ' + limited.mins + ' 分钟后再试',
            }));
            return;
        }
        limiter.note('dm_send', { ip: ws._ip || '', account: user.id });

        // 先查权限
        const check = storage.canSendDM(user.id, target);
        if (!check.ok) {
            ws.send(JSON.stringify({ type: 'error', msg: check.error }));
            return;
        }

        // 内部兜底校验
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
                from_avatar_color: user.avatar_color || '#888', from_avatar_ext: user.avatar_ext || '',
                content: msg.content, created_at: msg.created_at,
            },
        });
        registry.dmSend(user.id, {
            type: 'dm_sent',
            message: {
                id: msg.id, from: user.id, to: target,
                from_nickname: user.nickname,
                from_avatar_color: user.avatar_color || '#888',
                from_avatar_ext: user.avatar_ext || '',
                content: msg.content, created_at: msg.created_at,
            },
        });
        return;
    }

    if (data.type === 'dm_read') {
        const targetUser = storage.loadUser(String(data.target || ''));
        if (!targetUser.id) return;
        storage.markDMRead(user.id, targetUser.id);
    }

    if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
}

// 连接处理
function onConnect(ws, { user, ip }) {
    ws._ip = ip;
    ws._uid = user.id;
    registry.registerDm(user.id, ws);
    logger.wsConn(ip, 'dm', user.nickname, user.id, '');

    ws.on('message', raw => {
        let data; try { data = JSON.parse(raw.toString()); } catch (e) { return; }
        if (!data || typeof data !== 'object') return;
        try {
            handleMessage(ws, user, data);
        } catch (e) {
            logger.error('WS dm error:', e);
            try { ws.send(JSON.stringify({ type: 'error', msg: '消息处理失败' })); } catch (e2) {}
        }
    });

    ws.on('close', () => {
        registry.unregisterDm(user.id, ws);
        logger.wsClose(ip, 'dm', user.nickname, user.id, '');
    });
}

module.exports = { onConnect };
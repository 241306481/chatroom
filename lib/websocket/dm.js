'use strict';
const storage = require('../storage');
const messageView = require('../message-view');
const auth = require('../auth');
const messageLimit = require('../auth/message-limit');
const logger = require('../logger');
const registry = require('./registry');
const { PRIV, hasPriv } = require('../permissions');
const { sessionValid } = require('./session-guard');
function checkMessageLimit(user, content) {
    const cfg = storage.loadDomain('system').system_config || {};
    return messageLimit.checkMessageLength(user, content, cfg);
}
function handleMessage(ws, snapshotUser, data) {
    const fresh = storage.loadUser(snapshotUser.id);
    const user = (fresh && fresh.id) ? fresh : snapshotUser;
    if (!sessionValid(ws, snapshotUser.id)) {
        try { ws.send(JSON.stringify({ type: 'error', msg: '登录已失效，请重新登录' })); } catch (e) {}
        try { ws.close(4003, 'session ended'); } catch (e) {}
        return;
    }
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
    if (!hasPriv(user, 'base', PRIV.BASE.SEND_DM)) {
        try { ws.send(JSON.stringify({ type: 'error', msg: '系统已禁用私信功能' })); } catch (e) {}
        return;
    }
    if (data.type === 'dm_send') {
        const target = String(data.target || '');
        const content = String(data.content == null ? '' : data.content);
        if (!target || !content.trim()) return;
        const lengthCheck = checkMessageLimit(user, content);
        if (!lengthCheck.ok) {
            ws.send(JSON.stringify({ type: 'error', msg: lengthCheck.error }));
            return;
        }
        const limiter = require('../rate-limit');
        const limited = limiter.check('dm_send', {
            ip: ws._ip || '',
            account: user.id,
            local: ws._ipLocal === true,
        });
        if (limited) {
            ws.send(JSON.stringify({
                type: 'error',
                msg: require('../routes/_helpers').limitMessage('私信', limited),
            }));
            return;
        }
        limiter.note('dm_send', {
            ip: ws._ip || '',
            account: user.id,
            local: ws._ipLocal === true,
        });
        const check = storage.canSendDM(user.id, target);
        if (!check.ok) {
            ws.send(JSON.stringify({ type: 'error', msg: check.error }));
            return;
        }
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
    if (data.type === 'dm_edit') {
        const target = String(data.target || '');
        const id = String(data.message_id || '');
        const content = String(data.content == null ? '' : data.content);
        if (!target || !id) {
            ws.send(JSON.stringify({ type: 'error', msg: '参数错误' }));
            return;
        }
        if (!content.trim()) {
            ws.send(JSON.stringify({ type: 'error', msg: '消息不能为空' }));
            return;
        }
        const lengthCheck = checkMessageLimit(user, content);
        if (!lengthCheck.ok) {
            ws.send(JSON.stringify({ type: 'error', msg: lengthCheck.error }));
            return;
        }
        const msg = storage.findDMMessage(user.id, target, id);
        if (!msg || msg.deleted) {
            ws.send(JSON.stringify({ type: 'error', msg: '消息不存在或已删除' }));
            return;
        }
        if (msg.forwarded_from) {
            ws.send(JSON.stringify({ type: 'error', msg: '转发的消息不能编辑' }));
            return;
        }
        if (msg.from !== user.id) {
            ws.send(JSON.stringify({ type: 'error', msg: '只能编辑自己的私信' }));
            return;
        }
        const at = storage.nowIso();
        const ok = storage.updateDMMessage(user.id, target, id, {
            content, edited_at: at,
            edit_history: messageView.editHistory(msg, content, at),
        });
        if (!ok) {
            ws.send(JSON.stringify({ type: 'error', msg: '保存失败，请重试' }));
            return;
        }
        const editId = typeof data.edit_id === 'string'
            ? data.edit_id.slice(0, 80) : '';
        if (editId) {
            ws.send(JSON.stringify({
                type: 'edit_ack', edit_id: editId, message_id: id,
                content, edited_at: at,
            }));
        }
        const payload = {
            type: 'dm_edited',
            message_id: id,
            from: user.id,
            to: target,
            content,
            edited_at: at,
        };
        registry.dmSend(user.id, payload);
        registry.dmSend(target, payload);
        return;
    }
    if (data.type === 'dm_typing') {
        const target = String(data.target || '');
        if (!target || target === user.id) return;
        const now = Date.now();
        if (ws._lastTyping && now - ws._lastTyping < 1500) return;
        ws._lastTyping = now;
        if (!storage.canSendDM(user.id, target).ok) return;
        registry.dmSend(target, {
            type: 'dm_typing',
            from: user.id,
            from_nickname: user.nickname,
        });
        return;
    }
    if (data.type === 'dm_read') {
        const targetUser = storage.loadUser(String(data.target || ''));
        if (!targetUser.id) return;
        storage.markDMRead(user.id, targetUser.id);
        registry.dmSend(targetUser.id, {
            type: 'dm_read',
            by: user.id,
            by_nickname: user.nickname,
        });
    }
    if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
}
function onConnect(ws, { user, ip, ipLocal, token, ua }) {
    ws._ip = ip;
    ws._ipLocal = ipLocal === true;
    ws._uid = user.id;
    ws._token = token;
    ws._ua = ua || '';
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

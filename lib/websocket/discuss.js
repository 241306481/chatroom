'use strict';
const storage = require('../storage');
const auth = require('../auth');
const logger = require('../logger');
const registry = require('./registry');
const { PERM, hasPerm } = require('../permissions');

// ============================================================
// 消息处理
// ============================================================
function handleMessage(ws, dn, disc, user, data) {
    const k = registry.discussKey(dn, disc);
    const du = auth.getDomainUser(dn, user);

    // ---------------- 发送消息 ----------------
    if (data.type === 'message') {
        if (!hasPerm(du.perm, PERM.SEND_MESSAGE)) {
            ws.send(JSON.stringify({ type: 'error', msg: '无发送权限' })); return;
        }
        if (du.is_muted) {
            ws.send(JSON.stringify({ type: 'error', msg: '你已被禁言' })); return;
        }
        const content = storage.sliceChars(data.content, 8000);
        if (!content.trim()) {
            ws.send(JSON.stringify({ type: 'error', msg: '消息不能为空' })); return;
        }

        const msg = {
            id: storage.genUuid(), user_id: user.id, nickname: user.nickname,
            content, reply_to: data.reply_to || '', pinned: false,
            deleted: false, edited_at: '', created_at: storage.nowIso(),
        };
        storage.appendMessage(dn, disc, msg);
        auth.addExp(dn, user.id, 1);

        // 被回复者获得经验
        if (data.reply_to) {
            const replied = storage.findMessage(dn, disc, data.reply_to);
            if (replied && replied.user_id && replied.user_id !== user.id) {
                const awarded = Array.isArray(replied.reply_awarded)
                    ? replied.reply_awarded : [];
                if (!awarded.includes(user.id)) {
                    awarded.push(user.id);
                    storage.updateMessage(dn, disc, data.reply_to, { reply_awarded: awarded });
                    auth.addExp(dn, replied.user_id, 2);
                }
            }
        }

        logger.msg(ws._ip, dn, disc, user.nickname, storage.sliceChars(content, 100));

        let replyInfo = null;
        if (msg.reply_to) {
            const rm = storage.findMessage(dn, disc, msg.reply_to);
            if (rm && !rm.deleted) {
                replyInfo = {
                    id: rm.id,
                    nickname: rm.nickname || '?',
                    content: storage.sliceChars(rm.content, 80),
                };
            }
        }
        registry.broadcastDiscuss(k, {
            type: 'new_message',
            message: {
                id: msg.id, user_id: msg.user_id, nickname: msg.nickname,
                avatar_color: user.avatar_color || '#888',
                content: msg.content, created_at: msg.created_at,
                pinned: false, is_system: false,
                reply_to: msg.reply_to || '',
                reply_info: replyInfo,
            },
        });
        return;
    }

    // ---------------- 表情 ----------------
    if (data.type === 'reaction') {
        if (!hasPerm(du.perm, PERM.ADD_REACTION)) {
            ws.send(JSON.stringify({ type: 'error', msg: '无添加表情权限' })); return;
        }
        const emoji = String(data.emoji || '').trim().substring(0, 16);
        if (!emoji) return;
        const r = storage.toggleReaction(dn, disc, data.message_id, user.id, emoji);
        if (!r) return;
        registry.broadcastDiscuss(k, {
            type: 'reaction',
            message_id: data.message_id,
            emoji,
            user_id: user.id,
            added: r.added,
            count: r.count,
        });
        return;
    }

    // ---------------- 删除 ----------------
    if (data.type === 'delete') {
        const m = storage.findMessage(dn, disc, data.message_id);
        if (!m) return;
        const own = m.user_id === user.id;
        const can = (own && hasPerm(du.perm, PERM.DELETE_OWN_MESSAGE))
                 || hasPerm(du.perm, PERM.DELETE_ANY_MESSAGE);
        if (!can) return;
        storage.updateMessage(dn, disc, data.message_id, { deleted: true });
        registry.broadcastDiscuss(k, { type: 'message_deleted', message_id: data.message_id });
        return;
    }

    // ---------------- 置顶 ----------------
    if (data.type === 'pin') {
        if (!hasPerm(du.perm, PERM.PIN_MESSAGE)) return;
        const m = storage.findMessage(dn, disc, data.message_id);
        if (!m) return;
        const newPin = !m.pinned;
        const patch = { pinned: newPin };
        let awardExp = false;
        if (newPin && !m.ever_pinned) {
            patch.ever_pinned = true;
            awardExp = true;
        }
        storage.updateMessage(dn, disc, data.message_id, patch);
        if (awardExp) auth.addExp(dn, m.user_id, 5);
        registry.broadcastDiscuss(k, {
            type: 'message_pinned',
            message_id: data.message_id,
            pinned: newPin,
            message: newPin ? {
                id: m.id, content: m.content, nickname: m.nickname,
                user_id: m.user_id, is_system: !!m.is_system,
            } : null,
        });
        return;
    }

    if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
}

// ============================================================
// 连接处理
// ============================================================
function onConnect(ws, { dn, disc, user, ip }) {
    const k = registry.registerDiscuss(dn, disc, ws);
    ws._uid = user.id;
    ws._dn = dn;
    ws._disc = disc;
    ws._ip = ip;

    const wasOnline = storage.isOnline(user.id, dn);
    storage.setOnline(user.id, dn, true);
    logger.wsConn(ip, 'discuss', user.nickname, `${dn}/${disc}`);

    // 初始化在线列表
    const onlineUids = storage.listRealUsers()
        .filter(u => storage.isOnline(u.id, dn))
        .map(u => u.id);
    ws.send(JSON.stringify({ type: 'online_list', users: onlineUids }));

    // 首个连接 → 广播上线
    if (!wasOnline) {
        registry.broadcastToDomain(dn, { type: 'user_online', user_id: user.id });
        registry.broadcastStatus(dn, { type: 'user_online', user_id: user.id });
    }

    ws.on('message', raw => {
        let data; try { data = JSON.parse(raw.toString()); } catch (e) { return; }
        handleMessage(ws, dn, disc, user, data);
    });

    ws.on('close', () => {
        registry.unregisterDiscuss(k, ws);
        storage.setOnline(user.id, dn, false);
        if (!storage.isOnline(user.id, dn)) {
            registry.broadcastToDomain(dn, { type: 'user_offline', user_id: user.id });
            registry.broadcastStatus(dn, { type: 'user_offline', user_id: user.id });
        }
    });
}

module.exports = { onConnect };
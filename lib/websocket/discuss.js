'use strict';
const storage = require('../storage');
const auth = require('../auth');
const logger = require('../logger');
const registry = require('./registry');
const { PERM, PRIV, DUAL_CHECK, hasPriv, hasPrivAny, hasPerm, expandPerm } = require('../permissions');
const { parseMentions, dualCheckWs } = require('./discuss-guard');

function refreshAuth(dn, snapshotUser, ip) {
    const fresh = storage.loadUser(snapshotUser.id);
    const user = (fresh && fresh.id) ? fresh : snapshotUser;
    const domain = storage.loadDomain(dn);
    if (!domain.name) return { user, du: null, blocked: '域不存在' };
    if (ip && storage.isIpBanned(ip)) return { user, du: null, blocked: '你的 IP 已被封禁' };
    if (auth.isUserBanned(user)) return { user, du: null, blocked: '账号已被封禁' };
    if (auth.isUserBannedInDomain(domain, user.id)) return { user, du: null, blocked: '你已被本域封禁' };
    return { user, du: auth.getDomainUser(dn, user), blocked: null };
}

function handleMessage(ws, dn, disc, snapshotUser, data) {
    const k = registry.discussKey(dn, disc);

    const authState = refreshAuth(dn, snapshotUser, ws._ip);
    if (authState.blocked) {
        try {
            ws.send(JSON.stringify({ type: 'error', msg: authState.blocked }));
        } catch (e) {}
        try { ws.close(4003, authState.blocked); } catch (e) {}
        return;
    }
    const user = authState.user;
    const du = authState.du;

// 发送消息
    if (data.type === 'message') {
        {
            const r = dualCheckWs(user, du, 'send_message');
            if (!r.ok) { ws.send(JSON.stringify({ type: 'error', msg: r.msg })); return; }
        }
        if (du.is_muted) {
            ws.send(JSON.stringify({ type: 'error', msg: '你已被禁言' })); return;
        }
        const content = storage.sliceChars(data.content, 8000);
        if (!content.trim()) {
            ws.send(JSON.stringify({ type: 'error', msg: '消息不能为空' })); return;
        }

        const { mentions, silent } = parseMentions(content, dn, user, du);
        const msg = {
            id: storage.genUuid(), user_id: user.id, nickname: user.nickname,
            content, reply_to: data.reply_to || '', pinned: false,
            deleted: false, edited_at: '', created_at: storage.nowIso(),
            mentions, silent_mentions: silent,
        };
        storage.appendMessage(dn, disc, msg);
        auth.addExp(dn, user.id, 1);

        if (mentions.length > 0) {
            const domain = storage.loadDomain(dn);
            const dn2 = domain.display_name || dn;
            const url = '/domain/' + encodeURIComponent(dn)
                + '/discuss/' + encodeURIComponent(disc)
                + '#msg-' + msg.id;
            const preview = storage.sliceChars(content, 60)
                .replace(/@(@?)\[(\d+)\]/g, (whole, at, uid) => {
                    const u = storage.loadUser(uid);
                    return '@' + (u.nickname || ('user-' + uid));
                });
            const sysDmContent = '**' + user.nickname + '** 在「' + dn2 + '」#' + disc
                + ' 提到了你：\n\n> ' + preview + '\n\n[查看原消息](' + url + ')';
            for (const uid of mentions) {
                try { require('../auth').sendSystemDM(uid, sysDmContent); }
                catch (e) {}
            }
        }

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
            if (rm) {
                if (rm.deleted) {
                    replyInfo = { id: rm.id, deleted: true };
                } else if (rm.revoked) {
                    replyInfo = { id: rm.id, revoked: true };
                } else {
                    replyInfo = {
                        id: rm.id,
                        nickname: rm.nickname || '?',
                        content: storage.sliceChars(rm.content, 80),
                    };
                }
            }
        }
        registry.broadcastDiscuss(k, {
            type: 'new_message',
            message: {
                id: msg.id, user_id: msg.user_id, nickname: msg.nickname,
                avatar_color: user.avatar_color || '#888',
                content: msg.content, created_at: msg.created_at,
                pinned: false, is_system: false,
                is_mod: hasPerm(du.perm, PERM.MOD_BADGE),
                reply_to: msg.reply_to || '',
                reply_info: replyInfo,
            },
        });
        return;
    }

// 表情
    if (data.type === 'reaction') {
        {
            const r = dualCheckWs(user, du, 'add_reaction');
            if (!r.ok) { ws.send(JSON.stringify({ type: 'error', msg: r.msg })); return; }
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

// 删除
    if (data.type === 'delete') {
        const m = storage.findMessage(dn, disc, data.message_id);
        if (!m) return;
        // 必须先确定归属，再按 own/any 对应强度校验
        {
            const r = dualCheckWs(user, du, 'delete_message', m.user_id === user.id);
            if (!r.ok) { ws.send(JSON.stringify({ type: 'error', msg: r.msg })); return; }
        }
        const own = m.user_id === user.id;
        const can = (own && hasPerm(du.perm, PERM.DELETE_OWN_MESSAGE))
                 || hasPerm(du.perm, PERM.DELETE_ANY_MESSAGE);
        if (!can) return;
        storage.updateMessage(dn, disc, data.message_id, {
            deleted: true,
            deleted_at: storage.nowIso(),
        });
        registry.broadcastDiscuss(k, { type: 'message_deleted', message_id: data.message_id });
        return;
    }

    if (data.type === 'revoke') {
        const m = storage.findMessage(dn, disc, data.message_id);
        if (!m) return;
        if (m.revoked) return;
        if (m.deleted) return;

        {
            const r = dualCheckWs(user, du, 'revoke_message', m.user_id === user.id);
            if (!r.ok) { ws.send(JSON.stringify({ type: 'error', msg: r.msg })); return; }
        }

        const own = m.user_id === user.id;
        const can = (own && hasPerm(du.perm, PERM.REVOKE_OWN_MESSAGE))
                 || hasPerm(du.perm, PERM.REVOKE_ANY_MESSAGE);
        if (!can) {
            ws.send(JSON.stringify({ type: 'error', msg: '无撤回权限' }));
            return;
        }

        const patch = {
            revoked: true,
            revoked_at: storage.nowIso(),
            revoked_by: user.id,
        };
        const wasPinned = !!m.pinned;
        if (wasPinned) patch.pinned = false;

        storage.updateMessage(dn, disc, data.message_id, patch);

        registry.broadcastDiscuss(k, {
            type: 'message_revoked',
            message_id: data.message_id,
            revoked_by: user.id,
            revoked_by_nickname: user.nickname,
            revoked_at: patch.revoked_at,
            was_pinned: wasPinned,
        });
        return;
    }

// 置顶
    if (data.type === 'pin') {
        {
            const r = dualCheckWs(user, du, 'pin_message');
            if (!r.ok) { ws.send(JSON.stringify({ type: 'error', msg: r.msg })); return; }
        }
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

// 连接处理
function onConnect(ws, { dn, disc, user, ip }) {
    const k = registry.registerDiscuss(dn, disc, ws);
    ws._uid = user.id;
    ws._dn = dn;
    ws._disc = disc;
    ws._ip = ip;

    const wasOnline = storage.isOnline(user.id, dn);
    storage.setOnline(user.id, dn, true);
    logger.wsConn(ip, 'discuss', user.nickname, user.id, `${dn}/${disc}`);

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
        if (!data || typeof data !== 'object') return;
        try {
            handleMessage(ws, dn, disc, user, data);
        } catch (e) {
            logger.error('WS discuss error:', dn, disc, e);
            try { ws.send(JSON.stringify({ type: 'error', msg: '消息处理失败' })); } catch (e2) {}
        }
    });

    ws.on('close', () => {
        logger.wsClose(ip, 'discuss', user.nickname, user.id, `${dn}/${disc}`);
        registry.unregisterDiscuss(k, ws);
        storage.setOnline(user.id, dn, false);
        if (!storage.isOnline(user.id, dn)) {
            registry.broadcastToDomain(dn, { type: 'user_offline', user_id: user.id });
            registry.broadcastStatus(dn, { type: 'user_offline', user_id: user.id });
        }
    });
}

module.exports = { onConnect };
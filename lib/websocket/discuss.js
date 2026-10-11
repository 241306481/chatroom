'use strict';
const storage = require('../storage');
const auth = require('../auth');
const logger = require('../logger');
const registry = require('./registry');
const { PERM, PRIV, DUAL_CHECK, hasPriv, hasPrivAny, hasPerm, expandPerm } = require('../permissions');

function parseMentions(content, dn, senderUser, du) {
    const regex = /@(@?)\[(\d+)\]/g;
    const mentions = [];
    const silent = [];
    const seen = new Set();
    let m;
    const isSilent = (uid) => {
        if (m[1] === '@') return true;
        if (uid === senderUser.id) return true;
        if (!hasPerm(du.perm, PERM.MENTION_MEMBER)) return true;
        const domain = storage.loadDomain(dn);
        const isMember = domain.members && domain.members[uid];
        if (!isMember) {
            if (!hasPriv(senderUser, 'base', PRIV.BASE.MENTION_GLOBAL)) return true;
        }
        const u = storage.loadUser(uid);
        if (!u.id || u.is_system) return true;
        return false;
    };
    while ((m = regex.exec(content)) !== null) {
        const uid = m[2];
        if (seen.has(uid)) continue;
        seen.add(uid);
        if (isSilent(uid)) silent.push(uid);
        else mentions.push(uid);
    }
    return { mentions, silent };
}

// WebSocket 内联双检：返回 { ok, msg }
function dualCheckWs(user, du, opKey) {
    const conf = DUAL_CHECK[opKey];
    if (!conf) return { ok: false, msg: '未知权限检查项' };
    if (!hasPrivAny(user, conf.priv.group, conf.priv.bit)) {
        return { ok: false, msg: '系统禁用了「' + (conf.label || opKey) + '」权限' };
    }
    const expanded = expandPerm(du.perm || 0);
    if ((expanded & conf.perm) === 0) {
        return { ok: false, msg: '你没有「' + (conf.label || opKey) + '」的域内权限' };
    }
    return { ok: true };
}

// ============================================================
// 消息处理
// ============================================================
function handleMessage(ws, dn, disc, user, data) {
    const k = registry.discussKey(dn, disc);
    const du = auth.getDomainUser(dn, user);

    // ---------------- 发送消息 ----------------
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

    // ---------------- 表情 ----------------
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

    // ---------------- 删除 ----------------
    if (data.type === 'delete') {
        {
            const r = dualCheckWs(user, du, 'delete_message');
            if (!r.ok) { ws.send(JSON.stringify({ type: 'error', msg: r.msg })); return; }
        }
        const m = storage.findMessage(dn, disc, data.message_id);
        if (!m) return;
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
        {
            const r = dualCheckWs(user, du, 'revoke_message');
            if (!r.ok) { ws.send(JSON.stringify({ type: 'error', msg: r.msg })); return; }
        }
        const m = storage.findMessage(dn, disc, data.message_id);
        if (!m) return;
        if (m.revoked) return;
        if (m.deleted) return;

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

    // ---------------- 置顶 ----------------
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
        handleMessage(ws, dn, disc, user, data);
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
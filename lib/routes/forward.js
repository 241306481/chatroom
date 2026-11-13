'use strict';
const storage = require('../storage');
const messageView = require('../message-view');
const auth = require('../auth');
const websocket = require('../websocket');
const { route } = require('../router');
const { json, limitMessage } = require('./_helpers');
const { UnauthorizedError, checkDual } = require('../auth/privilege');
const { PERM, PRIV, hasPerm, hasPriv } = require('../permissions');
const DOMAIN_RE = /^[a-z0-9_-]{2,32}$/;
const DISCUSS_RE = /^[a-z0-9_-]{1,32}$/;

function safeName(v) {
    return typeof v === 'string' && v.length > 0 && v.length <= 64
        && !/[/\\\0]/.test(v) && !v.includes('..') && v !== '.';
}

function canSend(user, dn) {
    try {
        const du = auth.getDomainUser(dn, user);
        checkDual(user, du, 'view_discussion');
        checkDual(user, du, 'send_message');
        return !du.is_muted;
    } catch (e) {
        return false;
    }
}

route('GET', '/forward/targets', ({ res, user }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const targets = [];
    for (const dn of storage.listAllDomains()) {
        if (!canSend(user, dn)) continue;
        const domain = storage.loadDomain(dn);
        const discussions = storage.listDiscussions(dn).map(id => {
            const cfg = storage.loadDiscussion(dn, id) || {};
            return {
                id,
                title: cfg.title || id,
                count: storage.getMessageStats(dn, id).total,
            };
        });
        if (!discussions.length) continue;
        targets.push({
            domain: dn,
            display: domain.display_name || dn,
            discussions,
        });
    }
    const users = hasPriv(user, 'base', PRIV.BASE.SEND_DM)
        ? storage.listRealUsers()
            .filter(u => u.id !== user.id && storage.canSendDM(user.id, u.id).ok)
            .slice(0, 100)
            .map(u => ({
                id: u.id,
                nickname: u.nickname || '?',
                avatar_color: u.avatar_color || '#888',
                avatar_ext: u.avatar_ext || '',
                online: storage.isOnlineAnywhere(u.id),
            }))
        : [];
    json(res, 200, { ok: true, targets, users });
});

function parseIds(form) {
    const raw = form.message_ids != null ? form.message_ids : form.message_id;
    const list = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(',');
    const ids = [];
    const seen = new Set();
    for (const item of list) {
        const id = String(item || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= 100) break;
    }
    return ids;
}

function snapshotContent(source) {
    if (!source) return '';
    if (source.forwarded_from) return messageView.forwardContent(source.forwarded_from);
    return String(source.content || '');
}

function buildForwardMessage(user, forwardedFrom) {
    return {
        id: storage.genUuid(),
        user_id: user.id,
        nickname: user.nickname,
        content: '',
        reply_to: '',
        pinned: false,
        deleted: false,
        edited_at: '',
        created_at: storage.nowIso(),
        mentions: [],
        silent_mentions: [],
        forwarded_from: forwardedFrom,
    };
}

function broadcastForward(targetDn, targetDisc, user, targetUser, msg) {
    websocket.broadcastDiscussEvent(targetDn, targetDisc, {
        type: 'new_message',
        message: {
            id: msg.id,
            user_id: msg.user_id,
            nickname: msg.nickname,
            avatar_color: user.avatar_color || '#888',
            avatar_ext: user.avatar_ext || '',
            content: messageView.forwardContent(msg.forwarded_from),
            created_at: msg.created_at,
            pinned: false,
            is_system: false,
            is_mod: hasPerm(targetUser.perm, PERM.GENERAL.MOD_BADGE),
            reply_to: '',
            reply_info: null,
            edited_at: '',
            forwarded: true,
            forwarded_from: msg.forwarded_from,
        },
    });
}

function broadcastForwardDM(user, targetUser, msg) {
    const payload = {
        id: msg.id,
        from: user.id,
        to: targetUser.id,
        from_nickname: user.nickname,
        from_avatar_color: user.avatar_color || '#888',
        from_avatar_ext: user.avatar_ext || '',
        content: messageView.forwardContent(msg.forwarded_from),
        created_at: msg.created_at,
        forwarded: true,
        forwarded_from: msg.forwarded_from,
    };
    websocket.dmSend(targetUser.id, { type: 'dm_new', message: payload });
    websocket.dmSend(user.id, { type: 'dm_sent', message: payload });
}

route('POST', '/forward', ({ res, user, form, req }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const ids = parseIds(form);
    const targetDn = String(form.target_domain || '');
    const targetDisc = String(form.target_disc || '');
    const targetUserId = String(form.target_user || '');
    const sourceType = String(form.source_type || 'discuss');
    const mode = form.forward_mode === 'merge' ? 'merge' : 'split';
    if (!ids.length) {
        return json(res, 200, { ok: false, error: '参数不完整' });
    }
    if (sourceType !== 'dm' && sourceType !== 'discuss') {
        return json(res, 200, { ok: false, error: '原消息类型无效' });
    }
    if (sourceType === 'dm' && ids.length > 1) {
        return json(res, 200, { ok: false, error: '私信一次只能转发一条' });
    }
    let targetDmUser = null;
    let targetDomainUser = null;
    if (targetUserId) {
        if (targetUserId === user.id) {
            return json(res, 200, { ok: false, error: '不能转发给自己' });
        }
        targetDmUser = storage.loadUser(targetUserId);
        if (!targetDmUser.id || targetDmUser.is_system) {
            return json(res, 200, { ok: false, error: '目标用户无效' });
        }
        if (!hasPriv(user, 'base', PRIV.BASE.SEND_DM)) {
            return json(res, 403, { ok: false, error: '系统已禁用私信功能' });
        }
        const dmCheck = storage.canSendDM(user.id, targetUserId);
        if (!dmCheck.ok) {
            return json(res, 200, { ok: false, error: dmCheck.error });
        }
    } else {
        if (!targetDn || !targetDisc) {
            return json(res, 200, { ok: false, error: '参数不完整' });
        }
        if (!DOMAIN_RE.test(targetDn) || !DISCUSS_RE.test(targetDisc)) {
            return json(res, 200, { ok: false, error: '目标讨论无效' });
        }
        if (!storage.domainExists(targetDn)
            || !storage.loadDiscussion(targetDn, targetDisc).name) {
            return json(res, 200, { ok: false, error: '目标讨论不存在' });
        }
        targetDomainUser = auth.getDomainUser(targetDn, user);
        try {
            checkDual(user, targetDomainUser, 'view_discussion');
            checkDual(user, targetDomainUser, 'send_message');
        } catch (e) {
            return json(res, e.status || 403, { ok: false, error: e.message });
        }
        if (targetDomainUser.is_muted) {
            return json(res, 200, { ok: false, error: '你已在目标域被禁言' });
        }
    }
    const sources = [];
    if (sourceType === 'dm') {
        const peer = String(form.source_peer || '');
        if (!safeName(peer)) {
            return json(res, 200, { ok: false, error: '私信会话参数无效' });
        }
        const source = storage.findDMMessage(user.id, peer, ids[0]);
        if (!source || source.deleted) {
            return json(res, 200, { ok: false, error: '原消息不存在' });
        }
        if (source.from !== user.id && source.to !== user.id) {
            return json(res, 403, { ok: false, error: '无权转发该私信' });
        }
        const fromUser = storage.loadUser(source.from);
        sources.push({
            id: source.id,
            from: source.from,
            to: source.to,
            created_at: source.created_at || '',
            content: snapshotContent(source),
            origin: '转发自私信 · ' + ((fromUser && fromUser.nickname) || '?'),
        });
    } else {
        const sourceDn = String(form.source_domain || '');
        const sourceDisc = String(form.source_disc || '');
        if (!DOMAIN_RE.test(sourceDn) || !DISCUSS_RE.test(sourceDisc)) {
            return json(res, 200, { ok: false, error: '原讨论无效' });
        }
        if (!storage.domainExists(sourceDn)
            || !storage.loadDiscussion(sourceDn, sourceDisc).name) {
            return json(res, 200, { ok: false, error: '原讨论不存在' });
        }
        try {
            checkDual(user, auth.getDomainUser(sourceDn, user), 'view_discussion');
        } catch (e) {
            return json(res, e.status || 403, { ok: false, error: e.message });
        }
        const sourceDomain = storage.loadDomain(sourceDn);
        const cfg = storage.loadDiscussion(sourceDn, sourceDisc) || {};
        for (const id of ids) {
            const source = storage.findMessage(sourceDn, sourceDisc, id);
            if (!source || source.deleted || source.revoked) {
                return json(res, 200, { ok: false, error: '原消息不存在' });
            }
            sources.push({
                id: source.id,
                created_at: source.created_at || '',
                content: snapshotContent(source),
                origin: '转发自「' + (sourceDomain.display_name || sourceDn) + '」#'
                    + (cfg.title || sourceDisc) + ' · ' + (source.nickname || '?'),
            });
        }
    }
    sources.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const limiter = require('../rate-limit');
    const keys = { ip: (req && req._clientIp) || '', account: user.id };
    const limitAction = targetDmUser ? 'dm_send' : 'post_message';
    const limited = limiter.check(limitAction, keys);
    if (limited) {
        return json(res, 200, { ok: false, error: limitMessage('转发', limited) });
    }
    const outCount = (mode === 'merge' && sources.length > 1) ? 1 : sources.length;
    for (let i = 0; i < outCount; i++) limiter.note(limitAction, keys);
    const sourceDn = String(form.source_domain || '');
    const sourceDisc = String(form.source_disc || '');
    const lockedAt = storage.nowIso();
    function makeRef(items) {
        const list = items.map(item => ({
            id: item.id,
            origin: item.origin,
            content: String(item.content || ''),
        }));
        if (sourceType === 'dm') {
            return {
                type: 'dm', id: list[0].id, ids: list.map(item => item.id),
                from: sources[0].from, to: sources[0].to,
                locked_at: lockedAt, items: list,
            };
        }
        return {
            type: 'discuss', id: list[0].id, ids: list.map(item => item.id),
            domain: sourceDn, discuss: sourceDisc,
            locked_at: lockedAt, items: list,
        };
    }
    const messages = [];
    if (mode === 'merge' && sources.length > 1) {
        messages.push(buildForwardMessage(user, makeRef(sources)));
    } else {
        for (const source of sources) {
            messages.push(buildForwardMessage(user, makeRef([source])));
        }
    }
    if (targetDmUser) {
        for (const msg of messages) {
            let saved;
            try {
                saved = storage.appendDM(user.id, targetDmUser.id, '', {
                    forwarded_from: msg.forwarded_from,
                });
            } catch (e) {
                return json(res, 200, { ok: false, error: e.message });
            }
            broadcastForwardDM(user, targetDmUser, saved);
        }
    } else {
        for (const msg of messages) {
            storage.appendMessage(targetDn, targetDisc, msg);
            broadcastForward(targetDn, targetDisc, user, targetDomainUser, msg);
        }
    }
    const targetName = targetDmUser
        ? (targetDmUser.nickname || targetDmUser.id)
        : targetDisc;
    json(res, 200, {
        ok: true,
        count: messages.length,
        message: messages.length > 1
            ? '已转发 ' + messages.length + ' 条到 ' + targetName
            : '已转发到 ' + targetName,
    });
});

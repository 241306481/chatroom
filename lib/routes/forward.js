'use strict';
const storage = require('../storage');
const auth = require('../auth');
const websocket = require('../websocket');
const { route } = require('../router');
const { json, limitMessage } = require('./_helpers');
const { UnauthorizedError, checkDual } = require('../auth/privilege');
const { PERM, hasPerm } = require('../permissions');
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
    json(res, 200, { ok: true, targets });
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

function buildForwardMessage(user, content, forwardedFrom) {
    return {
        id: storage.genUuid(),
        user_id: user.id,
        nickname: user.nickname,
        content,
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
            content: msg.content,
            created_at: msg.created_at,
            pinned: false,
            is_system: false,
            is_mod: hasPerm(targetUser.perm, PERM.GENERAL.MOD_BADGE),
            reply_to: '',
            reply_info: null,
            edited_at: '',
        },
    });
}

route('POST', '/forward', ({ res, user, form, req }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const ids = parseIds(form);
    const targetDn = String(form.target_domain || '');
    const targetDisc = String(form.target_disc || '');
    const sourceType = String(form.source_type || 'discuss');
    const mode = form.forward_mode === 'merge' ? 'merge' : 'split';
    if (!ids.length || !targetDn || !targetDisc) {
        return json(res, 200, { ok: false, error: '参数不完整' });
    }
    if (sourceType !== 'dm' && sourceType !== 'discuss') {
        return json(res, 200, { ok: false, error: '原消息类型无效' });
    }
    if (sourceType === 'dm' && ids.length > 1) {
        return json(res, 200, { ok: false, error: '私信一次只能转发一条' });
    }
    if (!DOMAIN_RE.test(targetDn) || !DISCUSS_RE.test(targetDisc)) {
        return json(res, 200, { ok: false, error: '目标讨论无效' });
    }
    if (!storage.domainExists(targetDn)
        || !storage.loadDiscussion(targetDn, targetDisc).name) {
        return json(res, 200, { ok: false, error: '目标讨论不存在' });
    }
    const targetUser = auth.getDomainUser(targetDn, user);
    try {
        checkDual(user, targetUser, 'view_discussion');
        checkDual(user, targetUser, 'send_message');
    } catch (e) {
        return json(res, e.status || 403, { ok: false, error: e.message });
    }
    if (targetUser.is_muted) {
        return json(res, 200, { ok: false, error: '你已在目标域被禁言' });
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
            content: source.content,
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
                content: source.content,
                origin: '转发自「' + (sourceDomain.display_name || sourceDn) + '」#'
                    + (cfg.title || sourceDisc) + ' · ' + (source.nickname || '?'),
            });
        }
    }
    const limiter = require('../rate-limit');
    const keys = { ip: (req && req._clientIp) || '', account: user.id };
    const limited = limiter.check('post_message', keys);
    if (limited) {
        return json(res, 200, { ok: false, error: limitMessage('转发', limited) });
    }
    limiter.note('post_message', keys);
    const forwardedFrom = {
        type: sourceType,
        id: sources[0].id,
        ids: sources.map(s => s.id),
        domain: String(form.source_domain || ''),
        discuss: String(form.source_disc || ''),
    };
    const messages = [];
    if (mode === 'merge' && sources.length > 1) {
        const content = storage.sliceChars(sources.map(s =>
            '> ' + s.origin + '\n\n' + String(s.content || '')
        ).join('\n\n---\n\n'), 8000);
        messages.push(buildForwardMessage(user, content, forwardedFrom));
    } else {
        for (const source of sources) {
            const content = storage.sliceChars(
                '> ' + source.origin + '\n\n' + String(source.content || ''), 8000);
            messages.push(buildForwardMessage(user, content, {
                type: sourceType,
                id: source.id,
                domain: String(form.source_domain || ''),
                discuss: String(form.source_disc || ''),
            }));
        }
    }
    for (const msg of messages) {
        storage.appendMessage(targetDn, targetDisc, msg);
        broadcastForward(targetDn, targetDisc, user, targetUser, msg);
    }
    json(res, 200, {
        ok: true,
        count: messages.length,
        message: messages.length > 1 ? '已转发 ' + messages.length + ' 条' : '已转发',
    });
});

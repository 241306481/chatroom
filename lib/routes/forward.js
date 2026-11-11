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

function canAccess(user, dn) {
    try {
        checkDual(user, auth.getDomainUser(dn, user), 'view_discussion');
        return true;
    } catch (e) {
        return false;
    }
}

route('GET', '/forward/targets', ({ res, user }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const targets = [];
    for (const dn of storage.listAllDomains()) {
        if (!canAccess(user, dn)) continue;
        const domain = storage.loadDomain(dn);
        const discussions = storage.listDiscussions(dn).map(id => {
            const cfg = storage.loadDiscussion(dn, id) || {};
            return {
                id,
                title: cfg.title || id,
                count: storage.getMessageStats(dn, id).total,
            };
        });
        targets.push({
            domain: dn,
            display: domain.display_name || dn,
            discussions,
        });
    }
    json(res, 200, { ok: true, targets });
});

route('POST', '/forward', ({ res, user, form, req }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const id = String(form.message_id || '');
    const targetDn = String(form.target_domain || '');
    const targetDisc = String(form.target_disc || '');
    const sourceType = String(form.source_type || 'discuss');
    if (!id || !targetDn || !targetDisc) {
        return json(res, 200, { ok: false, error: '参数不完整' });
    }
    if (sourceType !== 'dm' && sourceType !== 'discuss') {
        return json(res, 200, { ok: false, error: '原消息类型无效' });
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
    let source;
    let origin;
    if (sourceType === 'dm') {
        const peer = String(form.source_peer || '');
        if (!safeName(peer)) {
            return json(res, 200, { ok: false, error: '私信会话参数无效' });
        }
        source = storage.findDMMessage(user.id, peer, id);
        if (!source || source.deleted) {
            return json(res, 200, { ok: false, error: '原消息不存在' });
        }
        if (source.from !== user.id && source.to !== user.id) {
            return json(res, 403, { ok: false, error: '无权转发该私信' });
        }
        const fromUser = storage.loadUser(source.from);
        origin = '转发自私信 · ' + ((fromUser && fromUser.nickname) || '?');
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
        source = storage.findMessage(sourceDn, sourceDisc, id);
        if (!source || source.deleted || source.revoked) {
            return json(res, 200, { ok: false, error: '原消息不存在' });
        }
        const sourceDomain = storage.loadDomain(sourceDn);
        const cfg = storage.loadDiscussion(sourceDn, sourceDisc) || {};
        origin = '转发自「' + (sourceDomain.display_name || sourceDn) + '」#'
            + (cfg.title || sourceDisc) + ' · ' + (source.nickname || '?');
    }
    const limiter = require('../rate-limit');
    const keys = { ip: (req && req._clientIp) || '', account: user.id };
    const limited = limiter.check('post_message', keys);
    if (limited) {
        return json(res, 200, { ok: false, error: limitMessage('转发', limited) });
    }
    limiter.note('post_message', keys);
    const content = storage.sliceChars(
        '> ' + origin + '\n\n' + String(source.content || ''), 8000);
    const msg = {
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
        forwarded_from: {
            type: sourceType,
            id,
            domain: String(form.source_domain || ''),
            discuss: String(form.source_disc || ''),
        },
    };
    storage.appendMessage(targetDn, targetDisc, msg);
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
    json(res, 200, { ok: true, message: '已转发' });
});

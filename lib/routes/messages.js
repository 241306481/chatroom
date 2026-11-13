'use strict';
const storage = require('../storage');
const messageView = require('../message-view');
const websocket = require('../websocket');
const { route } = require('../router');
const { render } = require('../template');
const { buildNav, buildDMFileView, json } = require('./_helpers');
const { withSiteName } = require('./home');
const { PRIV } = require('../permissions');
const { UnauthorizedError } = require('../auth/privilege');
const DM_PAGE_LIMIT = 100;
function formatDMMessages(list, viewer) {
    const users = new Map();
    const load = (uid) => {
        if (!users.has(uid)) users.set(uid, storage.loadUser(uid));
        return users.get(uid);
    };
    return (Array.isArray(list) ? list : []).map(m => {
        const fromUser = load(m.from);
        const forwarded = !!m.forwarded_from;
        return {
            id: m.id, from: m.from, to: m.to,
            content: forwarded
                ? messageView.forwardContent(m.forwarded_from)
                : m.content,
            created_at: m.created_at, edited_at: m.edited_at || '',
            forwarded,
            forwarded_from: forwarded ? m.forwarded_from : null,
            is_me: m.from === viewer,
            is_system: !!m.is_system,
            nickname: fromUser.nickname || '?',
            avatar_color: fromUser.avatar_color || '#888',
            avatar_ext: fromUser.avatar_ext || '',
            mentions: Array.isArray(m.mentions) ? m.mentions : [],
        };
    });
}
function publicUser(u) {
    return {
        id: u.id, nickname: u.nickname || '?',
        avatar_color: u.avatar_color || '#888', avatar_ext: u.avatar_ext || '',
        is_system: !!u.is_system,
        online: storage.isOnlineAnywhere(u.id),
    };
}
route('GET', '/messages', ({ res, user, query }) => {
    const target = query.target || '';
    let messages = [], targetUser = null, dmFiles = [];
    let can_send = true, can_send_error = '';
    let page = { messages: [], has_more: false, next_before: '' };
    if (target) {
        targetUser = storage.loadUser(target);
        if (targetUser.id) {
            if (target === user.id) {
                can_send = false;
                can_send_error = '不能给自己发私信';
            } else {
                storage.markDMRead(user.id, target);
                websocket.dmSend(target, {
                    type: 'dm_read',
                    by: user.id,
                    by_nickname: user.nickname,
                });
                page = storage.loadDMPage(user.id, target, {
                    limit: DM_PAGE_LIMIT,
                });
                messages = formatDMMessages(page.messages, user.id);
                dmFiles = storage.listDMAttachments(user.id, target)
                    .map(f => buildDMFileView(user.id, target, f));
                if (!targetUser.is_system) {
                    const chk = storage.canSendDM(user.id, target);
                    can_send = chk.ok;
                    can_send_error = chk.error || '';
                } else {
                    can_send = false;
                    can_send_error = '不能给系统发私信';
                }
            }
        }
    }
    const conversations = storage.listConversations(user.id).map(c => {
        const u = storage.loadUser(c.other);
        return {
            other: c.other, nickname: u.nickname || '?',
            id: u.id, avatar_color: u.avatar_color || '#888', avatar_ext: u.avatar_ext || '',
            last: storage.sliceChars(c.last.content, 40),
            last_at: c.last.created_at,
            unread: c.unread,
        };
    });
    render(res, 'messages.html', withSiteName({
        current_user: user, nav: buildNav(user),
        conversations, target, target_user: targetUser, messages,
        dm_files: dmFiles,
        dm_target: target,
        messages_total: messages.length,
        messages_offset: 0,
        messages_limit: DM_PAGE_LIMIT,
        messages_before: page.next_before || '',
        messages_has_more: !!page.has_more,
        can_send, can_send_error,
    }));
}, { priv: { group: 'base', bit: PRIV.BASE.SEND_DM } });
route('GET', '/messages/users', ({ res, query }) => {
    const users = storage.searchUsers(query.q || '', 20)
        .map(publicUser);
    json(res, 200, { ok: true, users });
}, { auth: true, priv: { group: 'base', bit: PRIV.BASE.SEND_DM } });
route('GET', '/messages/:peer/history', ({ res, user, params, query }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const peer = params.peer;
    if (!storage.loadUser(peer).id) {
        return json(res, 404, { ok: false, error: '用户不存在' });
    }
    if (peer === user.id) {
        return json(res, 200, {
            ok: true, messages: [], has_more: false, next_before: '',
        });
    }
    const limit = Math.max(1, Math.min(parseInt(query.limit || '50', 10) || 50, 100));
    const before = query.before ? String(query.before) : '';
    const page = storage.loadDMPage(user.id, peer, {
        beforeId: before, limit,
    });
    json(res, 200, {
        ok: true,
        messages: formatDMMessages(page.messages, user.id),
        has_more: page.has_more,
        next_before: page.next_before || '',
        before_missing: !!page.missing_before,
    });
}, { auth: true, priv: { group: 'base', bit: PRIV.BASE.SEND_DM } });
route('GET', '/messages/:peer/:message_id/history', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const peer = params.peer;
    if (!storage.loadUser(peer).id) {
        return json(res, 404, { ok: false, error: '用户不存在' });
    }
    if (peer === user.id) {
        return json(res, 200, { ok: true, versions: [] });
    }
    const msg = storage.findDMMessage(user.id, peer, params.message_id);
    if (!msg || msg.deleted) {
        return json(res, 404, { ok: false, error: '消息不存在' });
    }
    json(res, 200, {
        ok: true,
        versions: messageView.historyVersions(msg),
    });
}, { auth: true, priv: { group: 'base', bit: PRIV.BASE.SEND_DM } });

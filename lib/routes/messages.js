'use strict';
const storage = require('../storage');
const { route } = require('../router');
const { render } = require('../template');
const { deny401, buildNav, getWsProtocol } = require('./_helpers');

route('GET', '/messages', ({ res, user, query }) => {
    if (!user || !user.id) return deny401(res);
    const target = query.target || '';
    let messages = [], targetUser = null;
    let can_send = true, can_send_error = '';

    if (target) {
        targetUser = storage.loadUser(target);
        if (targetUser.id) {
            if (target === user.id) {
                can_send = false;
                can_send_error = '不能给自己发私信';
            } else {
                storage.markDMRead(user.id, target);
                messages = storage.loadDM(user.id, target, 200).map(m => ({
                    id: m.id, from: m.from, to: m.to, content: m.content,
                    created_at: m.created_at, is_me: m.from === user.id,
                    is_system: !!m.is_system,
                }));
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
            avatar_color: u.avatar_color || '#888',
            last: storage.sliceChars(c.last.content, 40),
            last_at: c.last.created_at,
            unread: c.unread,
        };
    });

    render(res, 'messages.html', {
        current_user: user, nav: buildNav(user),
        conversations, target, target_user: targetUser, messages,
        can_send, can_send_error,
        ws_protocol: getWsProtocol(),
    });
});
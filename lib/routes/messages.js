'use strict';
const storage = require('../storage');
const { route } = require('../router');
const { render } = require('../template');
const { buildNav, getWsProtocol } = require('./_helpers');
const { withSiteName } = require('./home');
const { PRIV } = require('../permissions');

route('GET', '/messages', ({ res, user, query }) => {
    const target = query.target || '';
    let messages = [], targetUser = null;
    let can_send = true, can_send_error = '';

    // 收集所有真实用户，供 /messages 的 "新增会话" 搜索下拉使用
    const allUsers = storage.listRealUsers().map(u => ({
        id: u.id,
        nickname: u.nickname,
        avatar_color: u.avatar_color || '#888',
        online: storage.isOnlineAnywhere(u.id),
    }));

    if (target) {
        targetUser = storage.loadUser(target);
        if (targetUser.id) {
            if (target === user.id) {
                can_send = false;
                can_send_error = '不能给自己发私信';
            } else {
                storage.markDMRead(user.id, target);
                messages = storage.loadDM(user.id, target, 200).map(m => {
                    const fromUser = storage.loadUser(m.from);
                    return {
                        id: m.id, from: m.from, to: m.to, content: m.content,
                        created_at: m.created_at, is_me: m.from === user.id,
                        is_system: !!m.is_system,
                        nickname: fromUser.nickname || '?',
                        avatar_color: fromUser.avatar_color || '#888',
                        mentions: Array.isArray(m.mentions) ? m.mentions : [],
                    };
                });
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

    render(res, 'messages.html', withSiteName({
        current_user: user, nav: buildNav(user),
        conversations, target, target_user: targetUser, messages,
        can_send, can_send_error,
        ws_protocol: getWsProtocol(),
        all_users: allUsers,
    }));
}, { priv: { group: 'base', bit: PRIV.BASE.SEND_DM } });

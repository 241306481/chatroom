'use strict';
const storage = require('../storage');
const auth = require('../auth');
const websocket = require('../websocket');
const { route } = require('../router');
const { render, render403, render404, alertBack } = require('../template');
const { redirect, deny401, buildNav, canEditDiscussion, getWsProtocol, buildUserList } = require('./_helpers');
const { PRIV, PERM, hasPriv, hasPerm } = require('../permissions');
const { withSiteName } = require('./home');

route('GET', '/domain/:domain_name/discuss', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    const domain = storage.loadDomain(dn);
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW_DISCUSSION)) return render403(res, '你没有查看讨论的权限');
    const discussions = storage.listDiscussions(dn).map(id => {
        const cfg = storage.loadDiscussion(dn, id) || {};
        return {
            id, title: cfg.title || '',
            count: storage.loadAllMessages(dn, id).filter(m => !m.deleted).length,
        };
    });
    render(res, 'discuss_list.html', withSiteName({
        domain_name: dn, display_name: domain.display_name || dn,
        current_user: user || {},
        nav: buildNav(user, dn),
        is_member: du.is_member,
        join_policy: domain.join_policy || 'open',
        discussions,
        can_create: hasPerm(du.perm, PERM.CREATE_DISCUSSION),
        can_edit_discuss: canEditDiscussion(du),
        ws_protocol: getWsProtocol(),
    }));
});

route('POST', '/domain/:domain_name/discuss', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) return deny401(res);
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.CREATE_DISCUSSION)) return render403(res, '你没有创建讨论的权限');
    const name = (form.name || '').trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) return alertBack(res, '讨论名只能含小写字母、数字、下划线、短横线');
    if (storage.loadDiscussion(dn, name).name) return alertBack(res, '讨论已存在');
    const cfg = { name, title: storage.sliceChars((form.title || '').trim(), 100), created_at: storage.nowIso() };
    storage.saveDiscussion(dn, name, cfg);
    websocket.broadcastDomainEvent(dn, { type: 'discussion_created', id: name, title: cfg.title });
    redirect(res, `/domain/${dn}/discuss/${name}`);
});

route('GET', '/domain/:domain_name/discuss/:disc_name', ({ res, user, params }) => {
    const { domain_name: dn, disc_name } = params;
    if (!storage.domainExists(dn)) return render404(res);
    if (!storage.loadDiscussion(dn, disc_name).name) return render404(res);
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW_DISCUSSION)) return render403(res, '你没有查看讨论的权限');
    render(res, 'discuss.html', buildDiscussData(dn, disc_name, user));
});

route('POST', '/domain/:domain_name/discuss/:disc_name/edit-title',
    ({ res, user, params, form }) => {
    const { domain_name: dn, disc_name } = params;
    if (!user || !user.id) return deny401(res);
    if (!storage.domainExists(dn)) return require('./_helpers').json(res, 404, { ok: false, error: '域不存在' });
    const du = auth.getDomainUser(dn, user);
    if (!canEditDiscussion(du)) return require('./_helpers').json(res, 403, { ok: false, error: '无编辑权限' });
    try {
        storage.updateDiscussionTitle(dn, disc_name, form.title || '');
        require('./_helpers').json(res, 200, { ok: true });
    } catch (e) {
        require('./_helpers').json(res, 200, { ok: false, error: e.message });
    }
});

route('POST', '/domain/:domain_name/discuss/:disc_name/rename',
    ({ res, user, params, form }) => {
    const { domain_name: dn, disc_name } = params;
    const { json } = require('./_helpers');
    if (!user || !user.id) return deny401(res);
    if (!storage.domainExists(dn)) return json(res, 404, { ok: false, error: '域不存在' });
    const du = auth.getDomainUser(dn, user);
    if (!canEditDiscussion(du)) return json(res, 403, { ok: false, error: '你没有编辑讨论的权限' });
    if (disc_name === 'general') return json(res, 200, { ok: false, error: 'general 不能重命名' });
    const newId = (form.new_id || '').trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(newId)) {
        return json(res, 200, { ok: false, error: '讨论 ID 只能含小写字母、数字、下划线、短横线（1-32 位）' });
    }
    if (newId === disc_name) return json(res, 200, { ok: true, new_id: newId, unchanged: true });
    try {
        const finalId = storage.renameDiscussion(dn, disc_name, newId);
        json(res, 200, { ok: true, new_id: finalId });
    } catch (e) {
        json(res, 200, { ok: false, error: e.message });
    }
});

function buildDiscussData(dn, discName, user) {
    const domain = storage.loadDomain(dn);
    const du = auth.getDomainUser(dn, user);

    const discussions = storage.listDiscussions(dn).map(id => {
        const cfg = storage.loadDiscussion(dn, id) || {};
        return { id, title: cfg.title || '', active: id === discName };
    });

    const allMsgs = storage.loadAllMessages(dn, discName);
    const msgMap = {};
    for (const m of allMsgs) if (!m.deleted) msgMap[m.id] = m;

    const messages = [];
    for (const m of allMsgs) {
        if (m.deleted) continue;
        const u = storage.loadUser(m.user_id);
        let replyInfo = null;
        if (m.reply_to && msgMap[m.reply_to]) {
            const rm = msgMap[m.reply_to];
            replyInfo = {
                id: rm.id,
                nickname: rm.nickname || '?',
                content: storage.sliceChars(rm.content, 80),
            };
        }
        messages.push({
            id: m.id, user_id: m.user_id, nickname: m.nickname || '?',
            avatar_color: u.avatar_color || '#888',
            content: m.content || '', pinned: !!m.pinned,
            is_system: !!m.is_system, created_at: m.created_at || '',
            reactions_json: JSON.stringify(m.reactions || {}),
            reply_to: m.reply_to || '',
            reply_info: replyInfo,
        });
    }

    const pinnedMessages = allMsgs.filter(m => m.pinned && !m.deleted).map(m => ({
        id: m.id, content: m.content, nickname: m.nickname || '?',
        user_id: m.user_id, is_system: !!m.is_system,
        reactions_json: JSON.stringify(m.reactions || {}),
    }));

    const members = buildUserList(dn);
    const onlineCount = members.filter(u => u.online).length;

    return withSiteName({
        domain_name: dn,
        discuss_name: discName,
        discuss_title: (storage.loadDiscussion(dn, discName) || {}).title || '',
        can_edit_discuss: canEditDiscussion(du),
        display_name: domain.display_name || dn,
        discussions, messages,
        pinned_messages: pinnedMessages,
        all_members: members,
        online_count: onlineCount, total_count: members.length,
        can_send: hasPerm(du.perm, PERM.SEND_MESSAGE) && !du.is_muted,
        can_pin: hasPerm(du.perm, PERM.PIN_MESSAGE),
        can_delete_any: hasPerm(du.perm, PERM.DELETE_ANY_MESSAGE),
        can_add_reaction: hasPerm(du.perm, PERM.ADD_REACTION),
        can_manage_discuss: hasPerm(du.perm, PERM.MANAGE_DISCUSSION) || hasPerm(du.perm, PERM.MANAGE_USER),
        can_mute: hasPerm(du.perm, PERM.MUTE_MEMBER),
        can_create_discuss: hasPerm(du.perm, PERM.CREATE_DISCUSSION),
        muted_until: du.muted_until,
        is_member: du.is_member,
        join_policy: domain.join_policy || 'open',
        current_user: user || {},
        nav: buildNav(user, dn),
        ws_protocol: getWsProtocol(),
    });
}

module.exports = { buildDiscussData };
'use strict';
const storage = require('../storage');
const auth = require('../auth');
const websocket = require('../websocket');
const { route } = require('../router');
const { render, render404, alertBack } = require('../template');
const { redirect, buildNav, canEditDiscussion, getWsProtocol, buildUserList } = require('./_helpers');
const { PRIV, PERM, hasPriv, hasPrivAny, hasPerm } = require('../permissions');
const { withSiteName } = require('./home');
const { UnauthorizedError, checkDual } = require('../auth/privilege');

const MESSAGE_PAGE_LIMIT = 100;

route('GET', '/domain/:domain_name/discuss', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    const domain = storage.loadDomain(dn);
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'view_discussion');
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
        can_create: hasPerm(du.perm, PERM.CREATE_DISCUSSION)
            && hasPriv(user, 'discuss', PRIV.DISCUSS.CREATE),
        can_edit_discuss: canEditDiscussion(du)
            && hasPrivAny(user, 'discuss',
                PRIV.DISCUSS.EDIT | PRIV.DISCUSS.DELETE | PRIV.DISCUSS.PIN),
        ws_protocol: getWsProtocol(),
    }));
});

route('POST', '/domain/:domain_name/discuss', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'create_discussion');
    const name = (form.name || '').trim();
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) return alertBack(res, '讨论名只能含小写字母、数字、下划线、短横线');
    if (storage.loadDiscussion(dn, name).name) return alertBack(res, '讨论已存在');
    const cfg = { name, title: storage.sliceChars((form.title || '').trim(), 100), created_at: storage.nowIso() };
    storage.saveDiscussion(dn, name, cfg);
    websocket.broadcastDomainEvent(dn, { type: 'discussion_created', id: name, title: cfg.title });
    redirect(res, `/domain/${dn}/discuss/${name}?ok=` + encodeURIComponent('讨论已创建'));
});

route('GET', '/domain/:domain_name/discuss/:disc_name', ({ res, user, params }) => {
    const { domain_name: dn, disc_name } = params;
    if (!storage.domainExists(dn)) return render404(res);
    if (!storage.loadDiscussion(dn, disc_name).name) return render404(res);
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'view_discussion');
    render(res, 'discuss.html', buildDiscussData(dn, disc_name, user));
});

route('POST', '/domain/:domain_name/discuss/:disc_name/edit-title',
    ({ res, user, params, form }) => {
    const { domain_name: dn, disc_name } = params;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return require('./_helpers').json(res, 404, { ok: false, error: '域不存在' });
    const du = auth.getDomainUser(dn, user);
    try {
        checkDual(user, du, 'edit_discussion');
    } catch (e) {
        return require('./_helpers').json(res, e.status || 403, { ok: false, error: e.message });
    }
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
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return json(res, 404, { ok: false, error: '域不存在' });
    const du = auth.getDomainUser(dn, user);
    try {
        checkDual(user, du, 'edit_discussion');
    } catch (e) {
        return json(res, e.status || 403, { ok: false, error: e.message });
    }
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

route('POST', '/domain/:domain_name/discuss/:disc_name/delete',
    ({ res, user, params }) => {
    const { domain_name: dn, disc_name } = params;
    const { json } = require('./_helpers');
    if (!user || !user.id) return json(res, 401, { ok: false, error: '未登录' });
    if (!storage.domainExists(dn)) return render404(res);
    if (disc_name === 'general') {
        return json(res, 403, { ok: false, error: 'general 不可删除' });
    }
    if (!storage.loadDiscussion(dn, disc_name).name) return render404(res);

    const du = auth.getDomainUser(dn, user);
    // 必须复用 checkDual，而不是手写「PRIV 位 + PERM 位」的判断：
    // 手写版本会漏掉 checkDual 里的 is_privileged 规则（域所有者 /
    // MANAGE_DOMAINS 的授权来自域所有权本身，不要求全局 discuss 位），
    // 于是同一个删除操作在这里被拒、在 manage/discussions.js 里却放行，
    // 两个入口自相矛盾。
    try {
        checkDual(user, du, 'delete_discussion');
    } catch (e) {
        return json(res, e.status || 403, { ok: false, error: e.message });
    }
    // 讨论配置未记录创建者，暂不支持「删除自己的讨论」
    const canAny = hasPerm(du.perm, PERM.DELETE_DISCUSSION)
        || hasPerm(du.perm, PERM.MANAGE_DISCUSSION);
    if (!canAny) {
        return json(res, 403, { ok: false, error: '仅管理员可删除讨论' });
    }

    storage.deleteDiscussion(dn, disc_name);
    websocket.broadcastDomainEvent(dn, {
        type: 'discussion_deleted', id: disc_name,
    });
    json(res, 200, { ok: true });
});

// MOD 徽章：按成员在域内的角色解析 MOD_BADGE
function buildMemberModMap(dn) {
    const domain = storage.loadDomain(dn);
    const map = {};
    for (const [uid, m] of Object.entries(domain.members || {})) {
        const roleName = m.role || 'default';
        const perm = auth.resolveRolePerm(dn, roleName);
        if (hasPerm(perm, PERM.MOD_BADGE)) map[uid] = true;
    }
    return map;
}

function buildDiscussData(dn, discName, user) {
    const domain = storage.loadDomain(dn);
    const du = auth.getDomainUser(dn, user);

    const memberModMap = buildMemberModMap(dn);

    const discussions = storage.listDiscussions(dn).map(id => {
        const cfg = storage.loadDiscussion(dn, id) || {};
        return { id, title: cfg.title || '', active: id === discName };
    });

    const allMsgs = storage.loadAllMessages(dn, discName);
    const msgMap = {};
    for (const m of allMsgs) msgMap[m.id] = m;

    const live = allMsgs.filter(m => !m.deleted);
    const total = live.length;
    const messages = [];
    for (const m of live.slice(-MESSAGE_PAGE_LIMIT)) {
        messages.push(formatMessage(m, msgMap[m.reply_to] || null, memberModMap));
    }

    const pinnedMessages = live.filter(m => m.pinned).map(m => ({
        id: m.id, content: m.content, nickname: m.nickname || '?',
        user_id: m.user_id, is_system: !!m.is_system,
        created_at: m.created_at || '',
        reactions_json: JSON.stringify(m.reactions || {}),
    }));

    const members = buildUserList(dn).map(u => ({ ...u, is_mod: !!memberModMap[u.id] }));
    const onlineCount = members.filter(u => u.online).length;

    return withSiteName({
        domain_name: dn,
        discuss_name: discName,
        discuss_title: (storage.loadDiscussion(dn, discName) || {}).title || '',
        can_edit_discuss: canEditDiscussion(du)
            && hasPrivAny(user, 'discuss',
                PRIV.DISCUSS.EDIT | PRIV.DISCUSS.DELETE | PRIV.DISCUSS.PIN),
        display_name: domain.display_name || dn,
        discussions, messages,
        pinned_messages: pinnedMessages,
        all_members: members,
        online_count: onlineCount, total_count: members.length,
        messages_total: total,
        messages_offset: 0,
        messages_limit: MESSAGE_PAGE_LIMIT,
        can_send: hasPerm(du.perm, PERM.SEND_MESSAGE)
            && hasPriv(user, 'message', PRIV.MESSAGE.SEND) && !du.is_muted,
        can_pin: hasPerm(du.perm, PERM.PIN_MESSAGE)
            && hasPriv(user, 'message', PRIV.MESSAGE.PIN),
        can_delete_any: hasPerm(du.perm, PERM.DELETE_ANY_MESSAGE)
            && hasPriv(user, 'message', PRIV.MESSAGE.DELETE_ANY),
        // 撤回与删除一样是 own/any 分离的双检操作，两个标志都要下发：
        // 前端 render.js 的撤回按钮依赖 __CAN_REVOKE_OWN__ / __CAN_REVOKE_ANY__，
        // 缺失时会让有权限的版主看不到按钮，而无权限的用户反而看到按钮后被服务端拒绝。
        can_revoke_own: hasPerm(du.perm, PERM.REVOKE_OWN_MESSAGE)
            && hasPriv(user, 'message', PRIV.MESSAGE.REVOKE_OWN),
        can_revoke_any: hasPerm(du.perm, PERM.REVOKE_ANY_MESSAGE)
            && hasPriv(user, 'message', PRIV.MESSAGE.REVOKE_ANY),
        can_add_reaction: hasPerm(du.perm, PERM.ADD_REACTION)
            && hasPriv(user, 'message', PRIV.MESSAGE.ADD_REACTION),
        can_manage_discuss: hasPerm(du.perm, PERM.MANAGE_DISCUSSION)
            && hasPrivAny(user, 'discuss',
                PRIV.DISCUSS.EDIT | PRIV.DISCUSS.DELETE | PRIV.DISCUSS.PIN),
        can_mute: hasPerm(du.perm, PERM.MUTE_MEMBER)
            && hasPriv(user, 'member', PRIV.MEMBER.MUTE),
        can_create_discuss: hasPerm(du.perm, PERM.CREATE_DISCUSSION)
            && hasPriv(user, 'discuss', PRIV.DISCUSS.CREATE),
        can_delete_current_disc: (hasPerm(du.perm, PERM.DELETE_DISCUSSION)
            || hasPerm(du.perm, PERM.MANAGE_DISCUSSION))
            && hasPriv(user, 'discuss', PRIV.DISCUSS.DELETE),
        muted_until: du.muted_until,
        is_member: du.is_member,
        join_policy: domain.join_policy || 'open',
        current_user: user || {},
        nav: buildNav(user, dn),
        ws_protocol: getWsProtocol(),
    });
}

function formatMessage(m, replyMsg, memberModMap) {
    let replyInfo = null;
    if (m.reply_to && replyMsg) {
        if (replyMsg.deleted) {
            replyInfo = { id: replyMsg.id, deleted: true };
        } else if (replyMsg.revoked) {
            replyInfo = { id: replyMsg.id, revoked: true };
        } else {
            replyInfo = {
                id: replyMsg.id,
                nickname: replyMsg.nickname || '?',
                content: storage.sliceChars(replyMsg.content, 80),
            };
        }
    }
    return {
        id: m.id, user_id: m.user_id, nickname: m.nickname || '?',
        avatar_color: storage.loadUser(m.user_id).avatar_color || '#888',
        content: m.content || '', pinned: !!m.pinned,
        is_system: !!m.is_system, created_at: m.created_at || '',
        reactions_json: JSON.stringify(m.reactions || {}),
        reply_to: m.reply_to || '',
        reply_info: replyInfo,
        revoked: !!m.revoked,
        revoked_at: m.revoked_at || '',
        revoked_by_nickname: m.revoked_by
            ? (storage.loadUser(m.revoked_by).nickname || '?')
            : '',
        mentions: Array.isArray(m.mentions) ? m.mentions : [],
        is_mod: !!(memberModMap && memberModMap[m.user_id]),
    };
}

route('GET', '/domain/:domain_name/discuss/:disc_name/messages',
    ({ res, user, params, query }) => {
    const { json } = require('./_helpers');
    const { domain_name: dn, disc_name: discName } = params;
    const limit = Math.max(1, Math.min(parseInt(query.limit || '50', 10) || 50, 100));
    const offset = Math.max(0, parseInt(query.offset || '0', 10) || 0);

    if (!storage.domainExists(dn)) return render404(res);
    if (!storage.loadDiscussion(dn, discName).name) return render404(res);

    const du = auth.getDomainUser(dn, user);
    try {
        checkDual(user, du, 'view_discussion');
    } catch (e) {
        return json(res, e.status || 403, { ok: false, error: e.message });
    }

    const memberModMap = buildMemberModMap(dn);
    const r = storage.loadMessageRange(dn, discName, offset, limit);
    const messages = r.messages.map(m => formatMessage(m, null, memberModMap));

    json(res, 200, {
        ok: true,
        messages,
        total: r.total,
        offset,
        limit,
        has_more: r.start > 0,
    });
});

module.exports = { buildDiscussData };

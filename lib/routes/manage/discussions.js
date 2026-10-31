'use strict';
const auth = require('../../auth');
const flash = require('../../flash');
const storage = require('../../storage');
const websocket = require('../../websocket');
const { route } = require('../../router');
const { render, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { UnauthorizedError, PrivilegeError, checkDual } = require('../../auth/privilege');
function parseIds(raw) {
    const out = [];
    for (const value of String(raw || '').split(',')) {
        const id = value.trim();
        if (!id || out.includes(id)) continue;
        if (out.length >= 200) throw new Error('一次最多选择 200 个讨论');
        out.push(id);
    }
    return out;
}
function batchTitleUpdates(discussions, form) {
    const mode = form.mode || 'replace';
    const find = String(form.find || '');
    const replace = String(form.replace || '');
    const value = String(form.value || '');
    if (mode === 'replace' && !find) throw new Error('查找内容不能为空');
    return discussions.map(d => {
        let title = d.title || '';
        if (mode === 'prefix') title = value + title;
        else if (mode === 'suffix') title = title + value;
        else title = title.split(find).join(replace);
        return { id: d.id, title };
    });
}
route('GET', '/domain/:domain_name/manage/discussions', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!auth.canManageDomain(user, dn)) throw new PrivilegeError('你没有管理此域的权限');
    const du = auth.getDomainUser(dn, user);
    const can = opKey => {
        try { checkDual(user, du, opKey); return true; } catch (e) { return false; }
    };
    const discussions = storage.listDiscussions(dn).map(id => {
        const cfg = storage.loadDiscussion(dn, id) || {};
        return {
            id,
            title: cfg.title || '',
            pinned: !!cfg.pinned,
            count: storage.loadAllMessages(dn, id).filter(m => !m.deleted).length,
        };
    });
    render(res, 'manage_discussions.html', withSiteName({
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, discussions,
        can_create_discuss: can('create_discussion'),
        can_delete_discuss: can('delete_discussion'),
        can_edit_discuss: can('edit_discussion'),
        can_pin_discuss: can('pin_discussion'),
    }));
});
route('POST', '/domain/:domain_name/manage/discussions', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    const redirectUrl = `/domain/${dn}/manage/discussions`;
    if (form.action === 'batch-pin' || form.action === 'batch-unpin') {
        checkDual(user, du, 'pin_discussion');
        try {
            const ids = parseIds(form.ids);
            if (!ids.length) throw new Error('没有选择讨论');
            const count = storage.setDiscussionsPinned(
                dn, ids, form.action === 'batch-pin');
            flash.redirectWith(res, redirectUrl,
                (form.action === 'batch-pin' ? '已置顶 ' : '已取消置顶 ') + count + ' 个讨论');
        } catch (e) {
            flash.redirectWith(res, redirectUrl, '批量操作失败：' + e.message);
        }
        return;
    }
    if (form.action === 'batch-delete') {
        checkDual(user, du, 'delete_discussion');
        try {
            const ids = parseIds(form.ids);
            if (!ids.length) throw new Error('没有选择讨论');
            const count = storage.deleteDiscussions(dn, ids);
            for (const id of ids) {
                websocket.broadcastDomainEvent(dn, { type: 'discussion_deleted', id });
            }
            flash.redirectWith(res, redirectUrl, `已删除 ${count} 个讨论`);
        } catch (e) {
            flash.redirectWith(res, redirectUrl, '批量操作失败：' + e.message);
        }
        return;
    }
    if (form.action === 'batch-title') {
        checkDual(user, du, 'edit_discussion');
        try {
            const ids = parseIds(form.ids);
            if (!ids.length) throw new Error('没有选择讨论');
            const list = ids.map(id => ({
                id, title: (storage.loadDiscussion(dn, id) || {}).title || '',
            }));
            const count = storage.setDiscussionTitles(dn, batchTitleUpdates(list, form));
            flash.redirectWith(res, redirectUrl, `已修改 ${count} 个讨论标题`);
        } catch (e) {
            flash.redirectWith(res, redirectUrl, '批量操作失败：' + e.message);
        }
        return;
    }
    if (form.action === 'create') {
        checkDual(user, du, 'create_discussion');
        const name = (form.name || '').trim();
        if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
            return alertBack(res, '讨论 ID 只能含小写字母、数字、下划线、短横线');
        }
        if (storage.loadDiscussion(dn, name).name) {
            return alertBack(res, '讨论 ID 已存在');
        }
        const cfg = {
            name,
            title: storage.sliceChars((form.title || '').trim(), 100),
            created_at: storage.nowIso(),
        };
        storage.saveDiscussion(dn, name, cfg);
        websocket.broadcastDomainEvent(dn, {
            type: 'discussion_created', id: name, title: cfg.title,
        });
    } else if (form.action === 'delete') {
        checkDual(user, du, 'delete_discussion');
        const name = String(form.name || '');
        if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
            res.writeHead(400); res.end('Invalid name'); return;
        }
        if (name === 'general') {
            return alertBack(res, '不能删除 general');
        }
        storage.deleteDiscussion(dn, name);
        websocket.broadcastDomainEvent(dn, { type: 'discussion_deleted', id: name });
    }
    flash.redirectWith(res, redirectUrl, '操作成功');
});

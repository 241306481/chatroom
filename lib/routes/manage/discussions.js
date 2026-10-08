'use strict';
const auth = require('../../auth');
const storage = require('../../storage');
const websocket = require('../../websocket');
const { route } = require('../../router');
const { render, render403, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, PERM, hasPriv, hasPerm } = require('../../permissions');

// ============================================================
// 讨论管理页
// ============================================================
route('GET', '/domain/:domain_name/manage/discussions', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    const discussions = storage.listDiscussions(dn).map(id => {
        const cfg = storage.loadDiscussion(dn, id) || {};
        return {
            id,
            title: cfg.title || '',
            count: storage.loadAllMessages(dn, id).filter(m => !m.deleted).length,
        };
    });
    render(res, 'manage_discussions.html', withSiteName({
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, discussions,
    }));
});

// ============================================================
// 讨论管理操作
// ============================================================
route('POST', '/domain/:domain_name/manage/discussions', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.MANAGE_DISCUSSION)
        && !hasPerm(du.perm, PERM.MANAGE_USER)
        && !hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN)) {
        return render403(res, '你没有管理讨论的权限');
    }
    const redirectUrl = `/domain/${dn}/manage/discussions`;

    if (form.action === 'create') {
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
    redirect(res, redirectUrl);
});
'use strict';
const path = require('path');
const fs = require('fs');
const storage = require('../../storage');
const auth = require('../../auth');
const { route } = require('../../router');
const { render, render403, render404, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { PRIV, PERM, hasPriv, hasPerm } = require('../../permissions');

// ============================================================
// 域概览
// ============================================================
route('GET', '/domain/:domain_name/manage', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    const pendingCount = (domain.join_applications || []).length;
    render(res, 'manage_domain.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        domain, pending_count: pendingCount,
    });
});

// ============================================================
// 编辑域
// ============================================================
route('GET', '/domain/:domain_name/manage/edit', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    render(res, 'domain_edit.html', {
        domain_name: dn, domain: storage.loadDomain(dn),
        current_user: user, nav: buildNav(user, dn), is_system: dn === 'system',
    });
});

route('POST', '/domain/:domain_name/manage/edit', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.EDIT_DOMAIN) && !hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN)) {
        return render403(res, '你没有编辑域的权限');
    }
    const domain = storage.loadDomain(dn);
    domain.display_name = form.display_name || domain.display_name;
    domain.announcement = form.announcement || '';
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/manage/edit`);
});

// ============================================================
// 加入设置
// ============================================================
route('GET', '/domain/:domain_name/manage/join', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    render(res, 'manage_join_settings.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        join_policy: domain.join_policy || 'open',
    });
});

route('POST', '/domain/:domain_name/manage/join', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.EDIT_DOMAIN) && !hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN)) {
        return render403(res, '你没有编辑域的权限');
    }
    const domain = storage.loadDomain(dn);
    const policy = form.join_policy || 'open';
    if (!['open', 'approval', 'closed'].includes(policy)) {
        res.writeHead(400); res.end('Invalid policy'); return;
    }
    domain.join_policy = policy;
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/manage/join`);
});

// ============================================================
// 加入申请
// ============================================================
route('GET', '/domain/:domain_name/manage/applications', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    render(res, 'manage_applications.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        applications: (domain.join_applications || []).map(a => ({ ...a })),
    });
});

route('POST', '/domain/:domain_name/manage/applications', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    const idx = (domain.join_applications || []).findIndex(a => a.uid === form.uid);
    if (idx === -1) { res.writeHead(404); res.end(); return; }

    if (form.action === 'approve') {
        if (auth.isUserBannedInDomain(domain, form.uid)) {
            return redirect(res, `/domain/${dn}/manage/applications?error=` +
                encodeURIComponent('该用户已被封禁，请先解封'));
        }
        if (!domain.members) domain.members = {};
        domain.members[form.uid] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
        auth.sendSystemDM(form.uid, `你加入「${domain.display_name || dn}」的申请已通过`);
    } else if (form.action === 'reject') {
        auth.sendSystemDM(form.uid, `你加入「${domain.display_name || dn}」的申请被拒绝`);
    }
    domain.join_applications.splice(idx, 1);
    storage.saveDomain(dn, domain);
    if (form.action === 'approve') require('../../websocket').broadcastMembersUpdate(dn);
    redirect(res, `/domain/${dn}/manage/applications`);
});

// ============================================================
// 删除域
// ============================================================
route('GET', '/domain/:domain_name/manage/delete', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    if (dn === 'system') { res.writeHead(400); res.end('不能删除 system'); return; }
    render(res, 'manage_delete.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, domain: storage.loadDomain(dn),
    });
});

route('POST', '/domain/:domain_name/manage/delete', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    if (dn === 'system') { res.writeHead(400); res.end('不能删除 system'); return; }
    if (form.confirm !== 'DELETE') return alertBack(res, '请输入 DELETE 确认');
    const dir = path.join(storage.DOMAIN_DIR, dn);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    redirect(res, '/manage');
});

// ============================================================
// 转让所有权
// ============================================================
route('GET', '/domain/:domain_name/manage/transfer', ({ res, user, params }) => {
    const dn = params.domain_name;
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    const isOwner = domain.owner_id === (user && user.id);
    const isSuper = user && hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN);
    if (!isOwner && !isSuper) return render403(res, '只有所有者可以转让此域');

    const members = [];
    for (const [uid, m] of Object.entries(domain.members || {})) {
        if (uid === domain.owner_id) continue;
        const u = storage.loadUser(uid);
        if (!u.id) continue;
        members.push({ id: uid, nickname: u.nickname, role: m.role || 'default' });
    }
    render(res, 'manage_transfer.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        members,
    });
});

route('POST', '/domain/:domain_name/manage/transfer', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    try {
        auth.transferDomain(dn, form.user_id, user);
    } catch (e) {
        return redirect(res, `/domain/${dn}/manage/transfer?error=` +
            encodeURIComponent(e.message));
    }
    redirect(res, `/domain/${dn}/manage`);
});
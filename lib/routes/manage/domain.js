'use strict';
const path = require('path');
const fs = require('fs');
const storage = require('../../storage');
const auth = require('../../auth');
const { route } = require('../../router');
const { render, render404, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { PRIV, hasPriv } = require('../../permissions');
const { UnauthorizedError, PrivilegeError, checkDual } = require('../../auth/privilege');

route('GET', '/domain/:domain_name/manage', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!auth.canManageDomain(user, dn)) throw new PrivilegeError('你没有管理此域的权限');
    const du = auth.getDomainUser(dn, user);
    const can = opKey => {
        try { checkDual(user, du, opKey); return true; } catch (e) { return false; }
    };
    const domain = storage.loadDomain(dn);
    const pendingCount = (domain.join_applications || []).length;
    render(res, 'manage_domain.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        domain, pending_count: pendingCount,
        // 入口按各自的双检结果显隐，避免点进去才吃 403
        can_edit: can('edit_domain'),
        can_discussions: can('create_discussion'),
        can_role: can('manage_role'),
        can_permission: can('manage_role'),
        can_manage_users: can('manage_user'),
        can_join: can('manage_join'),
        can_applications: can('manage_user'),
        can_delete: can('delete_domain'),
    });
});

route('GET', '/domain/:domain_name/manage/edit', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return render404(res);
    checkDual(user, auth.getDomainUser(dn, user), 'edit_domain');
    render(res, 'domain_edit.html', {
        domain_name: dn, domain: storage.loadDomain(dn),
        current_user: user, nav: buildNav(user, dn), is_system: dn === 'system',
    });
});

route('POST', '/domain/:domain_name/manage/edit', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'edit_domain');
    const domain = storage.loadDomain(dn);
    domain.display_name = form.display_name || domain.display_name;
    domain.announcement = form.announcement || '';
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/manage/edit?ok=1`);
});

route('GET', '/domain/:domain_name/manage/join', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    // 与 POST 同一条双检
    checkDual(user, auth.getDomainUser(dn, user), 'manage_join');
    const domain = storage.loadDomain(dn);
    render(res, 'manage_join_settings.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        join_policy: domain.join_policy || 'open',
    });
});

route('POST', '/domain/:domain_name/manage/join', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'manage_join');
    const domain = storage.loadDomain(dn);
    const policy = form.join_policy || 'open';
    if (!['open', 'approval', 'closed'].includes(policy)) {
        res.writeHead(400); res.end('Invalid policy'); return;
    }
    domain.join_policy = policy;
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/manage/join?ok=1`);
});

route('GET', '/domain/:domain_name/manage/applications', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    // 与同功能的 POST 保持同一条双检，避免只读入口泄露申请人的昵称与留言
    checkDual(user, auth.getDomainUser(dn, user), 'manage_user');
    const domain = storage.loadDomain(dn);
    render(res, 'manage_applications.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        applications: (domain.join_applications || []).map(a => ({ ...a })),
    });
});

route('POST', '/domain/:domain_name/manage/applications', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'manage_user');
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
    redirect(res, `/domain/${dn}/manage/applications?ok=1`);
});

route('GET', '/domain/:domain_name/manage/delete', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    checkDual(user, auth.getDomainUser(dn, user), 'delete_domain');
    if (dn === 'system') { res.writeHead(400); res.end('不能删除 system'); return; }
    render(res, 'manage_delete.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, domain: storage.loadDomain(dn),
    });
});

route('POST', '/domain/:domain_name/manage/delete', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'delete_domain');
    if (dn === 'system') { res.writeHead(400); res.end('不能删除 system'); return; }
    if (form.confirm !== 'DELETE') return alertBack(res, '请输入 DELETE 确认');
    const dir = path.join(storage.DOMAIN_DIR, dn);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    redirect(res, '/manage?ok=' + encodeURIComponent('域已删除'));
});

route('GET', '/domain/:domain_name/manage/transfer', ({ res, user, params }) => {
    const dn = params.domain_name;
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    const isOwner = domain.owner_id === (user && user.id);
    const isSuper = user && hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL);
    if (!isOwner && !isSuper) throw new PrivilegeError('只有所有者可以转让此域');

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
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return render404(res);
    try {
        auth.transferDomain(dn, form.user_id, user);
    } catch (e) {
        return redirect(res, `/domain/${dn}/manage/transfer?error=` +
            encodeURIComponent(e.message));
    }
    redirect(res, `/domain/${dn}/manage?ok=` + encodeURIComponent('所有权已转让'));
});

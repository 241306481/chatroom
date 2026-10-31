'use strict';
const path = require('path');
const flash = require('../../flash');
const fs = require('fs');
const storage = require('../../storage');
const auth = require('../../auth');
const { route } = require('../../router');
const { render, render404, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { UnauthorizedError, PrivilegeError, checkDual } = require('../../auth/privilege');
function parseIds(raw) {
    const ids = [];
    for (const value of String(raw || '').split(',')) {
        const id = value.trim();
        if (!id || ids.includes(id)) continue;
        if (ids.length >= 200) throw new Error('一次最多选择 200 个申请');
        ids.push(id);
    }
    return ids;
}
function guard(user, dn, opKey) {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return null;
    if (opKey) checkDual(user, auth.getDomainUser(dn, user), opKey);
    return auth.getDomainUser(dn, user);
}
route('GET', '/domain/:domain_name/manage', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    const can = opKey => {
        try { checkDual(user, du, opKey); return true; } catch (e) { return false; }
    };
    const domain = storage.loadDomain(dn);
    const pendingCount = (domain.join_applications || []).length;
    render(res, 'manage_domain.html', {
        can_anything: can('edit_domain') || can('manage_join')
            || can('manage_user') || can('manage_role')
            || can('manage_perm') || can('delete_domain'),
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        domain, pending_count: pendingCount,
        can_edit: can('edit_domain'),
        can_discussions: can('create_discussion'),
can_role: can('manage_role'),
    can_permission: can('manage_perm'),
        can_manage_users: can('manage_user'),
        can_join: can('manage_join'),
        can_applications: can('manage_user'),
        can_delete: can('delete_domain'),
    });
});
route('GET', '/domain/:domain_name/manage/edit', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = guard(user, dn, 'edit_domain');
    if (!du) return render404(res);
    render(res, 'domain_edit.html', {
        domain_name: dn, domain: storage.loadDomain(dn),
        current_user: user, nav: buildNav(user, dn), is_system: dn === 'system',
    });
});
route('POST', '/domain/:domain_name/manage/edit', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = guard(user, dn, 'edit_domain');
    if (!du) return render404(res);
    const domain = storage.loadDomain(dn);
    domain.display_name = form.display_name || domain.display_name;
    domain.announcement = form.announcement || '';
    storage.saveDomain(dn, domain);
    flash.redirectWith(res, `/domain/${dn}/manage/edit`, '操作成功');
});
route('GET', '/domain/:domain_name/manage/join', ({ res, user, params }) => {
    const dn = params.domain_name;
    const du = guard(user, dn, 'manage_join');
    if (!du) return render404(res);
    const domain = storage.loadDomain(dn);
    render(res, 'manage_join_settings.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        join_policy: domain.join_policy || 'open',
    });
});
route('POST', '/domain/:domain_name/manage/join', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = guard(user, dn, 'manage_join');
    if (!du) return render404(res);
    const domain = storage.loadDomain(dn);
    const policy = form.join_policy || 'open';
    if (!['open', 'approval', 'closed'].includes(policy)) {
        res.writeHead(400); res.end('Invalid policy'); return;
    }
    domain.join_policy = policy;
    storage.saveDomain(dn, domain);
    flash.redirectWith(res, `/domain/${dn}/manage/join`, '操作成功');
});
route('GET', '/domain/:domain_name/manage/applications', ({ res, user, params }) => {
    const dn = params.domain_name;
    const du = guard(user, dn, 'manage_user');
    if (!du) return render404(res);
    const domain = storage.loadDomain(dn);
    render(res, 'manage_applications.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        applications: (domain.join_applications || []).map(a => ({ ...a })),
    });
});
route('POST', '/domain/:domain_name/manage/applications', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = guard(user, dn, 'manage_user');
    if (!du) return render404(res);
    const domain = storage.loadDomain(dn);
    if (form.ids !== undefined) {
        const action = String(form.action || '');
        let ids;
        try {
            ids = parseIds(form.ids);
        } catch (e) {
            return redirect(res, `/domain/${dn}/manage/applications?error=` +
                encodeURIComponent(e.message));
        }
        if (action !== 'approve' && action !== 'reject') {
            return redirect(res, `/domain/${dn}/manage/applications?error=` +
                encodeURIComponent('未知批量操作'));
        }
        if (!ids.length) {
            return redirect(res, `/domain/${dn}/manage/applications?error=` +
                encodeURIComponent('没有选择申请'));
        }
        const apps = Array.isArray(domain.join_applications)
            ? domain.join_applications : [];
        for (const uid of ids) {
            const app = apps.find(a => a.uid === uid);
            if (!app) {
                return redirect(res, `/domain/${dn}/manage/applications?error=` +
                    encodeURIComponent('申请不存在：' + uid));
            }
            if (action === 'approve' && auth.isUserBannedInDomain(domain, uid)) {
                return redirect(res, `/domain/${dn}/manage/applications?error=` +
                    encodeURIComponent('用户 ' + (app.nickname || uid) + ' 已被封禁'));
            }
        }
        const selected = new Set(ids);
        const remain = [];
        if (!domain.members) domain.members = {};
        for (const app of apps) {
            if (!selected.has(app.uid)) { remain.push(app); continue; }
            if (action === 'approve') {
                domain.members[app.uid] = {
                    role: 'default', level: 0, exp: 0,
                    joined_at: storage.nowIso(),
                };
                auth.sendSystemDM(app.uid,
                    `你加入「${domain.display_name || dn}」的申请已通过`);
            } else {
                auth.sendSystemDM(app.uid,
                    `你加入「${domain.display_name || dn}」的申请被拒绝`);
            }
        }
        domain.join_applications = remain;
        storage.saveDomain(dn, domain);
        if (action === 'approve') require('../../websocket').broadcastMembersUpdate(dn);
        flash.redirectWith(res, `/domain/${dn}/manage/applications`,
            (action === 'approve' ? '已通过 ' : '已拒绝 ') + ids.length + ' 条申请');
        return;
    }
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
    flash.redirectWith(res, `/domain/${dn}/manage/applications`, '操作成功');
});
route('GET', '/domain/:domain_name/manage/delete', ({ res, user, params }) => {
    const dn = params.domain_name;
    const du = guard(user, dn, 'delete_domain');
    if (!du) return render404(res);
    if (dn === 'system') { res.writeHead(400); res.end('不能删除 system'); return; }
    render(res, 'manage_delete.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, domain: storage.loadDomain(dn),
    });
});
route('POST', '/domain/:domain_name/manage/delete', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = guard(user, dn, 'delete_domain');
    if (!du) return render404(res);
    if (dn === 'system') { res.writeHead(400); res.end('不能删除 system'); return; }
    if (form.confirm !== 'DELETE') return alertBack(res, '请输入 DELETE 确认');
    const domain = storage.loadDomain(dn);
    const members = Object.keys(domain.members || {});
    const name = domain.display_name || dn;
    const dir = path.join(storage.DOMAIN_DIR, dn);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    const ws = require('../../websocket');
    ws.broadcastDomainEvent(dn, { type: 'domain_deleted', name });
    for (const uid of members) ws.kickFromDomain(uid, dn);
    try { ws.broadcastMembersUpdate('system'); } catch (e) {}
    flash.redirectWith(res, '/manage', '域已删除');
});
route('GET', '/domain/:domain_name/manage/transfer', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!guard(user, dn, 'transfer_domain')) return render404(res);
    const domain = storage.loadDomain(dn);
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
    if (!guard(user, dn, 'transfer_domain')) return render404(res);
    try {
        auth.transferDomain(dn, form.user_id, user);
    } catch (e) {
        return redirect(res, `/domain/${dn}/manage/transfer?error=` +
            encodeURIComponent(e.message));
    }
    flash.redirectWith(res, `/domain/${dn}/manage`, '所有权已转让');
});

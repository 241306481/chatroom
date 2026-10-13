'use strict';
const auth = require('../../auth');
const storage = require('../../storage');
const websocket = require('../../websocket');
const { route } = require('../../router');
const { render, render403 } = require('../../template');
const { redirect, buildNav, buildUserList } = require('../_helpers');
const { withSiteName } = require('../home');
const { BUILTIN_ROLES } = require('../../permissions');
const { UnauthorizedError, PrivilegeError, checkDual } = require('../../auth/privilege');

route('GET', '/domain/:domain_name/manage/user', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    if (!auth.canManageDomain(user, dn)) throw new PrivilegeError('你没有管理此域的权限');
    const can = opKey => {
        try { checkDual(user, du, opKey); return true; } catch (e) { return false; }
    };
    const domain = storage.loadDomain(dn);

    const roles = [];
    for (const [name, role] of Object.entries(BUILTIN_ROLES)) {
        roles.push({ name, display: role.display });
    }
    if (domain.roles) {
        for (const [name, role] of Object.entries(domain.roles)) {
            roles.push({ name, display: role.display || name });
        }
    }

    render(res, 'manage_user.html', withSiteName({
        domain_name: dn, current_user: user, nav: buildNav(user, dn),
        users: buildUserList(dn), roles,
        is_system_domain: dn === 'system',
        can_manage: can('manage_user'),
        can_mute: can('mute_member'),
        can_kick: can('kick_member'),
    }));
});

route('POST', '/domain/:domain_name/manage/user', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'manage_user');

    const target = form.user_id;
    const redirectUrl = `/domain/${dn}/manage/user`;

    if (form.action === 'mute') {
        checkDual(user, du, 'mute_member');
        const mins = Math.max(1, Math.min(43200, parseInt(form.minutes, 10) || 60));
        const until = new Date(Date.now() + mins * 60 * 1000)
            .toISOString().replace(/\.\d{3}Z$/, 'Z');
        try {
            auth.muteUser(dn, target, until, user);
        } catch (e) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(e.message));
        }
    } else if (form.action === 'unmute') {
        checkDual(user, du, 'mute_member');
        auth.unmuteUser(dn, target);
    } else if (form.action === 'grant') {
        checkDual(user, du, 'manage_user');
        const roleName = String(form.role || '');
        // canGrantRole 在 canChangeRole 之上额外挡住「把别人提升为 root」
        const check = auth.canGrantRole(user, dn, target, roleName);
        if (!check.ok) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(check.error));
        }
        const domain = storage.loadDomain(dn);
        const validRoles = new Set([
            ...Object.keys(BUILTIN_ROLES),
            ...Object.keys(domain.roles || {}),
        ]);
        if (!validRoles.has(roleName)) {
            return render403(res, '无效的角色');
        }
        try {
            auth.grantRole(dn, target, roleName);
        } catch (e) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(e.message));
        }
    } else if (form.action === 'kick') {
        checkDual(user, du, 'kick_member');
        const check = auth.canKickUser(user, dn, target);
        if (!check.ok) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(check.error));
        }
        auth.kickUser(dn, target);
        websocket.kickFromDomain(target, dn);
        websocket.broadcastMembersUpdate(dn);
    } else if (form.action === 'ban') {
        checkDual(user, du, 'kick_member');
        let until = form.until || '';
        if (until && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(until)) {
            until = '';
        }
        try {
            auth.banUserInDomain(dn, target, form.reason || '', until, user);
            websocket.kickFromDomain(target, dn);
            websocket.broadcastMembersUpdate(dn);
        } catch (e) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(e.message));
        }
    } else if (form.action === 'unban') {
        checkDual(user, du, 'kick_member');
        auth.unbanUserInDomain(dn, target);
    }
    redirect(res, redirectUrl + '?ok=1');
});

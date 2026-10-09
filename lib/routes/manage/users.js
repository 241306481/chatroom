'use strict';
const auth = require('../../auth');
const storage = require('../../storage');
const websocket = require('../../websocket');
const { route } = require('../../router');
const { render, render403 } = require('../../template');
const { redirect, buildNav, buildUserList } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, PERM, BUILTIN_ROLES, hasPriv, hasPerm } = require('../../permissions');
const { UnauthorizedError, PrivilegeError, checkPerm } = require('../../auth/privilege');

route('GET', '/domain/:domain_name/manage/user', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    if (!auth.canManageDomain(user, dn)) throw new PrivilegeError('你没有管理此域的权限');
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
        can_manage: hasPerm(du.perm, PERM.MANAGE_USER)
            || hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN),
        can_mute: hasPerm(du.perm, PERM.MUTE_MEMBER)
            || hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN),
        can_kick: hasPerm(du.perm, PERM.KICK_MEMBER)
            || hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN),
    }));
});

route('POST', '/domain/:domain_name/manage/user', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    const superAdmin = hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN);
    if (!hasPerm(du.perm, PERM.MANAGE_USER) && !superAdmin) {
        throw new PrivilegeError('你没有管理用户的权限');
    }

    const target = form.user_id;
    const redirectUrl = `/domain/${dn}/manage/user`;

    const canMute   = hasPerm(du.perm, PERM.MUTE_MEMBER) || superAdmin;
    const canKick   = hasPerm(du.perm, PERM.KICK_MEMBER) || superAdmin;
    const canManage = hasPerm(du.perm, PERM.MANAGE_USER) || superAdmin;

    if (form.action === 'mute') {
        if (!canMute) return render403(res, '你没有禁言的权限');
        const mins = Math.max(1, Math.min(43200, parseInt(form.minutes, 10) || 60));
        const until = new Date(Date.now() + mins * 60 * 1000)
            .toISOString().replace(/\.\d{3}Z$/, 'Z');
        auth.muteUser(dn, target, until);
    } else if (form.action === 'unmute') {
        if (!canMute) return render403(res, '你没有禁言的权限');
        auth.unmuteUser(dn, target);
    } else if (form.action === 'grant') {
        if (!canManage && !hasPerm(du.perm, PERM.MANAGE_ROLE)) {
            return render403(res, '你没有管理角色的权限');
        }
        const check = auth.canChangeRole(user, dn, target);
        if (!check.ok) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(check.error));
        }
        const roleName = String(form.role || '');
        const domain = storage.loadDomain(dn);
        const validRoles = new Set([
            ...Object.keys(BUILTIN_ROLES),
            ...Object.keys(domain.roles || {}),
        ]);
        if (!validRoles.has(roleName)) {
            return render403(res, '无效的角色');
        }
        auth.grantRole(dn, target, roleName);
    } else if (form.action === 'kick') {
        if (!canKick) return render403(res, '你没有踢出的权限');
        const check = auth.canKickUser(user, dn, target);
        if (!check.ok) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(check.error));
        }
        auth.kickUser(dn, target);
        websocket.kickFromDomain(target, dn);
        websocket.broadcastMembersUpdate(dn);
    } else if (form.action === 'ban') {
        if (!canKick) return render403(res, '你没有踢出的权限');
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
        if (!canKick) return render403(res, '你没有踢出的权限');
        auth.unbanUserInDomain(dn, target);
    }
    redirect(res, redirectUrl);
});

'use strict';
const auth = require('../../auth');
const storage = require('../../storage');
const websocket = require('../../websocket');
const { route } = require('../../router');
const { render, render403 } = require('../../template');
const { redirect, buildNav, buildUserList } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, PERM, BUILTIN_ROLES, hasPriv, hasPerm } = require('../../permissions');

// ============================================================
// 域用户管理页
// ============================================================
route('GET', '/domain/:domain_name/manage/user', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    const du = auth.getDomainUser(dn, user);
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

// ============================================================
// 域用户操作（禁言 / 踢出 / 角色 / 封禁）
// ============================================================
route('POST', '/domain/:domain_name/manage/user', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    const du = auth.getDomainUser(dn, user);
    const superAdmin = hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN);
    if (!hasPerm(du.perm, PERM.MANAGE_USER) && !superAdmin) {
        return render403(res, '你没有管理用户的权限');
    }

    const target = form.user_id;
    const redirectUrl = `/domain/${dn}/manage/user`;

    if (form.action === 'mute' && (hasPerm(du.perm, PERM.MUTE_MEMBER) || superAdmin)) {
        const mins = parseInt(form.minutes || '60', 10);
        const until = new Date(Date.now() + mins * 60 * 1000)
            .toISOString().replace(/\.\d{3}Z$/, 'Z');
        auth.muteUser(dn, target, until);
    } else if (form.action === 'unmute') {
        auth.unmuteUser(dn, target);
    } else if (form.action === 'grant') {
        const check = auth.canChangeRole(user, dn, target);
        if (!check.ok) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(check.error));
        }
        auth.grantRole(dn, target, form.role || 'default');
    } else if (form.action === 'kick' && (hasPerm(du.perm, PERM.KICK_MEMBER) || superAdmin)) {
        const check = auth.canKickUser(user, dn, target);
        if (!check.ok) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(check.error));
        }
        auth.kickUser(dn, target);
        websocket.kickFromDomain(target, dn);
        websocket.broadcastMembersUpdate(dn);
    } else if (form.action === 'ban' && (hasPerm(du.perm, PERM.KICK_MEMBER) || superAdmin)) {
        try {
            auth.banUserInDomain(dn, target, form.reason || '', form.until || '', user);
            websocket.kickFromDomain(target, dn);
            websocket.broadcastMembersUpdate(dn);
        } catch (e) {
            return redirect(res, redirectUrl + '?error=' + encodeURIComponent(e.message));
        }
    } else if (form.action === 'unban') {
        auth.unbanUserInDomain(dn, target);
    }
    redirect(res, redirectUrl);
});
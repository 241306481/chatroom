'use strict';
const flash = require('../flash');
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render, render404, alertBack } = require('../template');
const { redirect, json, buildNav, domainPath } = require('./_helpers');
const { PERM } = require('../permissions');
const { withSiteName } = require('./home');
const { UnauthorizedError, checkPerm } = require('../auth/privilege');
route('GET', '/domain/:domain_name', ({ res, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    redirect(res, `/domain/${dn}/home`);
});
route('GET', '/domain/:domain_name/home', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    checkPerm(du, PERM.GENERAL.VIEW);
    const { buildHomeData } = require('./home');
    render(res, 'home.html', buildHomeData(dn, user));
});
route('GET', '/domain/:domain_name/users', ({ res, user, params }) => {
    const dn = params.domain_name;
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    const du = auth.getDomainUser(dn, user);
    checkPerm(du, PERM.GENERAL.VIEW);
    const { buildUserList } = require('./_helpers');
    const { checkDual } = require('../auth/privilege');
    const can = (opKey) => {
        try { checkDual(user, du, opKey); return true; } catch (e) { return false; }
    };
    render(res, 'users.html', withSiteName({
        domain_name: dn,
        display_name: domain.display_name || dn,
        is_domain_view: true,
        current_user: user || {},
        nav: buildNav(user, dn),
        users: buildUserList(dn),
        can_manage: can('manage_user'),
        can_mute: can('mute_member'),
        can_kick: can('kick_member'),
        roles: can('manage_user')
            ? Object.entries(require('../storage/system-roles').loadRoles())
                .map(([name, r]) => ({ name, display: r.display }))
            : [],
        is_system_domain: dn === 'system',
    }));
});
route('GET', '/domain/:domain_name/join', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    const members = domain.members && typeof domain.members === 'object'
        && !Array.isArray(domain.members) ? domain.members : null;
    if (members && members[user.id]) {
        return redirect(res, domainPath(res, dn, '/home'));
    }
    const policy = domain.join_policy || 'open';
    if (policy === 'closed') {
        return redirect(res, domainPath(res, dn, '/home'));
    }
    render(res, 'join.html', withSiteName({
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        join_policy: policy,
    }));
});
route('POST', '/domain/:domain_name/join', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    const members = domain.members && typeof domain.members === 'object'
        && !Array.isArray(domain.members) ? domain.members : null;
    if (members && members[user.id]) {
        return json(res, 200, { ok: true, redirect: domainPath(res, dn, '/home') });
    }
    if (auth.isUserBannedInDomain(domain, user.id)) {
        const b = domain.bans[user.id];
        return alertBack(res, '你已被禁止加入此域'
            + (b.reason ? '：' + b.reason : '')
            + (b.until ? '（至 ' + b.until + '）' : '（永久）'));
    }
    const policy = domain.join_policy || 'open';
    if (policy === 'closed') return alertBack(res, '此域已关闭加入');
    if (policy === 'open') {
        if (!domain.members || typeof domain.members !== 'object'
            || Array.isArray(domain.members)) {
            domain.members = {};
        }
        domain.members[user.id] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
        storage.saveDomain(dn, domain);
        require('../websocket').broadcastMembersUpdate(dn);
        return flash.jsonWith(res, domainPath(res, dn, '/home'), '已加入域');
    }
    const applications = Array.isArray(domain.join_applications)
        ? domain.join_applications : [];
    if (applications.find(a => a && a.uid === user.id)) {
        return alertBack(res, '已提交申请，请等待审批');
    }
    applications.push({
        uid: user.id, nickname: user.nickname,
        message: storage.sliceChars(form.message || '', 500),
        created_at: storage.nowIso(),
    });
    domain.join_applications = applications;
    storage.saveDomain(dn, domain);
    flash.jsonWith(res, domainPath(res, dn, '/home'), '加入申请已提交');
});

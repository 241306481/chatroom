'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render, render403, render404, alertBack } = require('../template');
const { redirect, buildNav, canEditDiscussion, getWsProtocol } = require('./_helpers');
const { PRIV, PERM, hasPriv, hasPerm } = require('../permissions');

route('GET', '/domain/:domain_name', ({ res, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    redirect(res, `/domain/${dn}/home`);
});

route('GET', '/domain/:domain_name/home', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW)) return render403(res, '你没有查看此域的权限');
    const { buildHomeData } = require('./home');
    render(res, 'home.html', buildHomeData(dn, user));
});

route('GET', '/domain/:domain_name/users', ({ res, user, params }) => {
    const dn = params.domain_name;
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW)) return render403(res, '你没有查看成员列表的权限');
    const { buildUserList } = require('./_helpers');
    render(res, 'users.html', {
        domain_name: dn,
        display_name: domain.display_name || dn,
        is_domain_view: true,
        current_user: user || {},
        nav: buildNav(user, dn),
        users: buildUserList(dn),
    });
});

route('GET', '/domain/:domain_name/join', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) return require('./_helpers').deny401(res);
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    if (domain.members && domain.members[user.id]) return redirect(res, `/domain/${dn}/home`);
    render(res, 'join.html', {
        current_user: user, nav: buildNav(user, dn),
        domain_name: dn, display_name: domain.display_name || dn,
        join_policy: domain.join_policy || 'open',
    });
});

route('POST', '/domain/:domain_name/join', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) return require('./_helpers').deny401(res);
    const domain = storage.loadDomain(dn);
    if (!domain.name) return render404(res);
    if (domain.members && domain.members[user.id]) return redirect(res, `/domain/${dn}/home`);

    if (auth.isUserBannedInDomain(domain, user.id)) {
        const b = domain.bans[user.id];
        return alertBack(res, '你已被禁止加入此域'
            + (b.reason ? '：' + b.reason : '')
            + (b.until ? '（至 ' + b.until + '）' : '（永久）'));
    }

    const policy = domain.join_policy || 'open';
    if (policy === 'closed') return alertBack(res, '此域已关闭加入');
    if (policy === 'open') {
        if (!domain.members) domain.members = {};
        domain.members[user.id] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
        storage.saveDomain(dn, domain);
        return redirect(res, `/domain/${dn}/home`);
    }
    if (!domain.join_applications) domain.join_applications = [];
    if (domain.join_applications.find(a => a.uid === user.id)) {
        return alertBack(res, '已提交申请，请等待审批');
    }
    domain.join_applications.push({
        uid: user.id, nickname: user.nickname,
        message: form.message || '', created_at: storage.nowIso(),
    });
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/home`);
});
'use strict';
const storage = require('../storage');
const auth = require('../auth');
const websocket = require('../websocket');
const { route } = require('../router');
const { render, render403 } = require('../template');
const { redirect, deny401, buildNav } = require('./_helpers');
const { PRIV, hasPriv } = require('../permissions');

route('GET', '/manage', ({ res, user }) => {
    if (!user || !user.id) return deny401(res);
    const isSystemAdmin = hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM);
    const all = storage.listAllDomains();
    const manageable = all.filter(dn => auth.canManageDomain(user, dn)).map(dn => {
        const d = storage.loadDomain(dn);
        return {
            name: dn, display: d.display_name || dn,
            member_count: Object.keys(d.members || {}).length,
            pending_count: (d.join_applications || []).length,
            owner_id: d.owner_id || '',
        };
    });
    if (!isSystemAdmin && manageable.length === 0) return render403(res, '你没有管理权限');
    let totalPending = 0;
    for (const dn of all) totalPending += (storage.loadDomain(dn).join_applications || []).length;
    render(res, 'manage.html', {
        current_user: user, nav: buildNav(user),
        domains: manageable, is_system_admin: isSystemAdmin,
        pending_count: totalPending,
    });
});

route('GET', '/manage/settings', ({ res, user }) => {
    if (!user || !hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM)) return render403(res, '仅超级管理员可访问');
    render(res, 'manage_settings.html', {
        current_user: user, nav: buildNav(user),
        config: storage.loadDomain('system').system_config || {},
    });
});
route('POST', '/manage/settings', ({ res, user, form }) => {
    if (!user || !hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM)) return render403(res, '仅超级管理员可访问');
    const domain = storage.loadDomain('system');
    if (!domain.system_config) domain.system_config = {};
    domain.system_config.site_name = form.site_name || '离线聊天室';
    domain.system_config.site_announcement = form.site_announcement || '';
    domain.system_config.allow_register = form.allow_register === 'on';
    domain.system_config.allow_create_domain = form.allow_create_domain === 'on';
    domain.system_config.allow_file_upload = form.allow_file_upload === 'on';
    domain.system_config.max_domains_per_user = parseInt(form.max_domains_per_user || '5', 10);
    domain.system_config.max_file_size_mb = parseInt(form.max_file_size_mb || '50', 10);
    domain.system_config.session_timeout_hours = parseInt(form.session_timeout_hours || '24', 10);
    storage.saveDomain('system', domain);
    redirect(res, '/manage/settings');
});

route('GET', '/manage/users', ({ res, user }) => {
    if (!user || (!hasPriv(user.priv || 0, PRIV.MANAGE_USERS)
                  && !hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM))) {
        return render403(res, '你没有管理用户的权限');
    }
    const users = storage.listRealUsers().map(u => ({
        id: u.id, nickname: u.nickname || '?',
        avatar_color: u.avatar_color || '#888',
        banned: !!u.banned,
        ban_reason: u.ban_reason || '',
        banned_until: u.banned_until || '',
        online: storage.isOnlineAnywhere(u.id),
        is_superuser: hasPriv(u.priv || 0, PRIV.MANAGE_ALL_DOMAIN),
        is_admin: hasPriv(u.priv || 0, PRIV.MANAGE_SYSTEM),
        owns_domains: storage.listAllDomains().filter(dn => storage.loadDomain(dn).owner_id === u.id),
    }));
    render(res, 'manage_users.html', { current_user: user, nav: buildNav(user), users });
});

route('POST', '/manage/users/ban', ({ res, user, form }) => {
    if (!user || (!hasPriv(user.priv || 0, PRIV.MANAGE_USERS)
                  && !hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM))) {
        return render403(res, '你没有管理用户的权限');
    }
    try {
        if (form.action === 'ban') {
            auth.banUserGlobally(form.user_id, form.reason || '', form.until || '', user.id);
            websocket.kickFromAllDomains(form.user_id, '你已被全局封禁');
        } else if (form.action === 'unban') {
            auth.unbanUserGlobally(form.user_id);
        }
    } catch (e) {
        return redirect(res, '/manage/users?error=' + encodeURIComponent(e.message));
    }
    redirect(res, '/manage/users');
});

route('POST', '/manage/users/admin', ({ res, user, form }) => {
    if (!user || !hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM)) return render403(res, '仅超级管理员可操作');
    try {
        auth.setSystemAdmin(form.user_id, form.action === 'grant');
    } catch (e) {
        return redirect(res, '/manage/users?error=' + encodeURIComponent(e.message));
    }
    redirect(res, '/manage/users');
});

route('GET', '/manage/join_applications', ({ res, user }) => {
    if (!user || !user.id) return deny401(res);
    const all = [];
    for (const dn of storage.listAllDomains()) {
        if (!auth.canManageDomain(user, dn)) continue;
        const d = storage.loadDomain(dn);
        for (const app of (d.join_applications || [])) {
            all.push({
                domain_name: dn, domain_display: d.display_name || dn,
                uid: app.uid, nickname: app.nickname,
                message: app.message, created_at: app.created_at,
            });
        }
    }
    render(res, 'manage_join_applications.html', {
        current_user: user, nav: buildNav(user), applications: all,
    });
});
route('POST', '/manage/join_applications', ({ res, user, form }) => {
    if (!user || !user.id) return deny401(res);
    const dn = form.domain_name;
    if (!auth.canManageDomain(user, dn)) return render403(res, '你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    const idx = (domain.join_applications || []).findIndex(a => a.uid === form.uid);
    if (idx === -1) { res.writeHead(404); res.end(); return; }
    if (form.action === 'approve') {
        if (auth.isUserBannedInDomain(domain, form.uid)) {
            return redirect(res, '/manage/join_applications?error=' + encodeURIComponent('该用户已被封禁'));
        }
        if (!domain.members) domain.members = {};
        domain.members[form.uid] = { role: 'default', level: 0, exp: 0, joined_at: storage.nowIso() };
        auth.sendSystemDM(form.uid, `你加入「${domain.display_name || dn}」的申请已通过`);
    } else if (form.action === 'reject') {
        auth.sendSystemDM(form.uid, `你加入「${domain.display_name || dn}」的申请被拒绝`);
    }
    domain.join_applications.splice(idx, 1);
    storage.saveDomain(dn, domain);
    redirect(res, '/manage/join_applications');
});

// 创建域
route('GET', '/create/domain', ({ res, user }) => {
    if (!user || !user.id) return deny401(res);
    const cfg = storage.loadDomain('system').system_config || {};
    render(res, 'create_domain.html', {
        current_user: user, nav: buildNav(user),
        allow: cfg.allow_create_domain !== false,
        max: cfg.max_domains_per_user || 5,
    });
});
route('POST', '/create/domain', ({ res, user, form }) => {
    if (!user || !user.id) return deny401(res);
    const cfg = storage.loadDomain('system').system_config || {};
    if (cfg.allow_create_domain === false) return require('../template').alertBack(res, '创建域已关闭');
    const owned = storage.listAllDomains().filter(dn => storage.loadDomain(dn).owner_id === user.id);
    if (owned.length >= (cfg.max_domains_per_user || 5)) return require('../template').alertBack(res, '已达最大域数');
    try {
        const name = (form.name || '').trim();
        storage.createDomain(name, (form.display_name || name).trim(), user.id);
        redirect(res, `/domain/${name}/home`);
    } catch (e) {
        require('../template').alertBack(res, e.message);
    }
});

// 我的域
route('GET', '/mydomain', ({ res, user }) => {
    if (!user || !user.id) return deny401(res);
    const myDomains = [];
    for (const dn of storage.listAllDomains()) {
        const d = storage.loadDomain(dn);
        if (d.members && d.members[user.id]) {
            myDomains.push({
                name: dn, display: d.display_name || dn,
                announcement: d.announcement || '',
                is_owner: d.owner_id === user.id,
            });
        }
    }
    render(res, 'mydomain.html', { current_user: user, nav: buildNav(user), domains: myDomains });
});
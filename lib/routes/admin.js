'use strict';
const sysRoles = require('../storage/system-roles');
const storage = require('../storage');
const auth = require('../auth');
const websocket = require('../websocket');
const { route } = require('../router');
const { render, render403 } = require('../template');
const { redirect, buildNav } = require('./_helpers');
const { PRIV, hasPriv } = require('../permissions');
const { withSiteName } = require('./home');
const { UnauthorizedError, PrivilegeError, checkPriv, checkDual } = require('../auth/privilege');

// 封禁到期时间是 ISO 字符串，并且 isUserBannedInDomain 靠字典序比较判断，
// 因此必须严格校验格式，否则 until=abc 会让账号变成永久封禁。
function normalizeUntil(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(s)) return null;
    const t = Date.parse(s);
    if (isNaN(t)) return null;
    if (new Date(t).toISOString().slice(0, 19) !== s.replace(/Z$/, '')) return null;
    return s;
}

function clampInt(raw, dflt, lo, hi) {
    const n = parseInt(raw, 10);
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
}

route('GET', '/manage', ({ res, user }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const isSystemAdmin = hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL);
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
    render(res, 'manage.html', withSiteName({
        current_user: user, nav: buildNav(user),
        domains: manageable, is_system_admin: isSystemAdmin,
        pending_count: totalPending,
    }));
});

route('GET', '/manage/settings', ({ res, user }) => {
    render(res, 'manage_settings.html', withSiteName({
        current_user: user, nav: buildNav(user),
        config: storage.loadDomain('system').system_config || {},
    }));
}, { priv: { group: 'system', bit: PRIV.SYSTEM.MANAGE_PANEL } });

route('POST', '/manage/settings', ({ res, user, form }) => {
    // EDIT_SETTINGS 是 /manage/permissions 上可单独取消的权限位，
    // 必须真正强制执行，否则取消勾选只是 UI 假象。
    checkPriv(user, 'system', PRIV.SYSTEM.EDIT_SETTINGS);
    const domain = storage.loadDomain('system');
    if (!domain.system_config) domain.system_config = {};
    const cfg = domain.system_config;
    cfg.site_name = form.site_name || '聊天室';
    cfg.site_announcement = form.site_announcement || '';
    cfg.allow_register = form.allow_register === 'on';
    cfg.max_domains_per_user = clampInt(form.max_domains_per_user, 5, 1, 1000);
    cfg.max_file_size_mb = clampInt(form.max_file_size_mb, 50, 1, 4096);
    cfg.session_timeout_hours = clampInt(form.session_timeout_hours, 24, 1, 24 * 365);
    storage.saveDomain('system', domain);
    redirect(res, '/manage/settings?ok=1');
}, { priv: { group: 'system', bit: PRIV.SYSTEM.MANAGE_PANEL } });

route('GET', '/manage/users', ({ res, user }) => {
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_USERS)
        && !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        throw new PrivilegeError('你没有管理用户的权限');
    }
    const users = storage.listRealUsers().map(u => ({
        id: u.id, nickname: u.nickname || '?',
        avatar_color: u.avatar_color || '#888',
        banned: !!u.banned,
        ban_reason: u.ban_reason || '',
        banned_until: u.banned_until || '',
        online: storage.isOnlineAnywhere(u.id),
        is_superuser: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_ALL),
        is_admin: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_PANEL),
        owns_domains: storage.listAllDomains().filter(dn => storage.loadDomain(dn).owner_id === u.id),
        system_role: u.system_role || 'member',
    }));
    const rolesList = Object.entries(sysRoles.loadRoles())
        .map(([name, r]) => ({ name, display: r.display }));
    render(res, 'manage_users.html', withSiteName({
        current_user: user, nav: buildNav(user), users, roles: rolesList,
    }));
});

route('POST', '/manage/users/ban', ({ res, user, form }) => {
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_USERS)
        && !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        throw new PrivilegeError('你没有管理用户的权限');
    }
    try {
        if (form.action === 'ban') {
            const until = normalizeUntil(form.until);
            if (until === null) {
                return redirect(res, '/manage/users?error=' +
                    encodeURIComponent('封禁到期时间格式无效，应为 2024-06-01T12:00:00Z'));
            }
            auth.banUserGlobally(form.user_id, form.reason || '', until, user.id);
            websocket.kickFromAllDomains(form.user_id, '你已被全局封禁');
        } else if (form.action === 'unban') {
            auth.unbanUserGlobally(form.user_id);
        }
    } catch (e) {
        return redirect(res, '/manage/users?error=' + encodeURIComponent(e.message));
    }
    redirect(res, '/manage/users?ok=1');
});

route('POST', '/manage/users/role', ({ res, user, form }) => {
    if (!user || !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        return render403(res, '仅超级管理员可操作');
    }
    try {
        const { setSystemRole } = require('../auth');
        setSystemRole(form.user_id, form.role || 'member');
    } catch (e) {
        return redirect(res, '/manage/users?error=' + encodeURIComponent(e.message));
    }
    redirect(res, '/manage/users?ok=1');
}, { priv: { group: 'system', bit: PRIV.SYSTEM.MANAGE_PANEL } });

route('GET', '/manage/join_applications', ({ res, user }) => {
    const all = [];
    for (const dn of storage.listAllDomains()) {
        // 与 POST 使用同一条双检。canManageDomain 会被 MANAGE_DISCUSSION
        // 满足且完全不做 PRIV 检查，不能用于管理成员入域。
        try {
            checkDual(user, auth.getDomainUser(dn, user), 'manage_user');
        } catch (e) { continue; }
        const d = storage.loadDomain(dn);
        for (const app of (d.join_applications || [])) {
            all.push({
                domain_name: dn, domain_display: d.display_name || dn,
                uid: app.uid, nickname: app.nickname,
                message: app.message, created_at: app.created_at,
            });
        }
    }
    render(res, 'manage_join_applications.html', withSiteName({
        current_user: user, nav: buildNav(user), applications: all,
    }));
}, { auth: true });

route('POST', '/manage/join_applications', ({ res, user, form }) => {
    const dn = form.domain_name;
    if (!dn || !storage.domainExists(dn)) { res.writeHead(404); res.end(); return; }
    checkDual(user, auth.getDomainUser(dn, user), 'manage_user');
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
    if (form.action === 'approve') websocket.broadcastMembersUpdate(dn);
    let okMsg = '';
    if (form.action === 'approve') okMsg = '申请已通过';
    else if (form.action === 'reject') okMsg = '申请已拒绝';
    if (okMsg) {
        redirect(res, '/manage/join_applications?ok=' + encodeURIComponent(okMsg));
    } else {
        redirect(res, '/manage/join_applications');
    }
}, { auth: true });

route('GET', '/create/domain', ({ res, user }) => {
    const cfg = storage.loadDomain('system').system_config || {};
    render(res, 'create_domain.html', withSiteName({
        current_user: user, nav: buildNav(user),
        allow: user && hasPriv(user, 'base', PRIV.BASE.CREATE_DOMAIN),
        max: cfg.max_domains_per_user || 5,
    }));
}, { auth: true });

route('POST', '/create/domain', ({ res, user, form }) => {
    const cfg = storage.loadDomain('system').system_config || {};
    checkPriv(user, 'base', PRIV.BASE.CREATE_DOMAIN);
    const owned = storage.listAllDomains().filter(dn => storage.loadDomain(dn).owner_id === user.id);
    if (owned.length >= (cfg.max_domains_per_user || 5)) return require('../template').alertBack(res, '已达最大域数');
    try {
        const name = (form.name || '').trim();
        storage.createDomain(name, (form.display_name || name).trim(), user.id);
        redirect(res, `/domain/${name}/home?ok=` + encodeURIComponent('域已创建'));
    } catch (e) {
        require('../template').alertBack(res, e.message);
    }
}, { auth: true });

route('GET', '/mydomain', ({ res, user }) => {
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
    render(res, 'mydomain.html', withSiteName({ current_user: user, nav: buildNav(user), domains: myDomains }));
}, { auth: true });

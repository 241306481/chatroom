const flash = require('../flash');
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
    for (const dn of manageable) totalPending += dn.pending_count;
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
    flash.redirectWith(res, '/manage/settings', '操作成功');
}, { priv: { group: 'system', bit: PRIV.SYSTEM.MANAGE_PANEL } });
route('GET', '/manage/users', ({ res, user }) => {
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_USERS)
        && !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        throw new PrivilegeError('你没有管理用户的权限');
    }
    const users = storage.listRealUsers().map(u => ({
        id: u.id, nickname: u.nickname || '?',
avatar_color: u.avatar_color || '#888', avatar_ext: u.avatar_ext || '',
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
        can_set_role: hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL),
    }));
});
route('POST', '/manage/users/ban', ({ res, user, form }) => {
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_USERS)
        && !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        throw new PrivilegeError('你没有管理用户的权限');
    }
    try {
        if (form.action === 'ban') {
            const until = auth.normalizeUntil(form.until);
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
    flash.redirectWith(res, '/manage/users', '操作成功');
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
    flash.redirectWith(res, '/manage/users', '操作成功');
}, { priv: { group: 'system', bit: PRIV.SYSTEM.MANAGE_PANEL } });
route('POST', '/manage/users/batch', ({ res, user, form }) => {
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_USERS)
        && !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        throw new PrivilegeError('你没有管理用户的权限');
    }
    const action = String(form.action || '');
    try {
        const ids = [];
        for (const raw of String(form.ids || '').split(',')) {
            const id = raw.trim();
            if (!id || ids.includes(id)) continue;
            if (ids.length >= 200) throw new Error('一次最多选择 200 个用户');
            ids.push(id);
        }
        if (!ids.length) throw new Error('没有选择用户');
        if (action !== 'ban' && action !== 'unban') throw new Error('未知批量操作');
        const until = action === 'ban' ? auth.normalizeUntil(form.until) : '';
        if (until === null) throw new Error('封禁到期时间格式无效');
        for (const uid of ids) {
            const target = storage.loadUser(uid);
            if (!target.id) throw new Error('用户不存在');
            if (target.is_system) throw new Error('不能操作系统账户');
            if (uid === user.id) throw new Error('不能操作自己');
            if (action === 'ban') {
                if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
                    throw new Error('不能封禁超级管理员');
                }
                if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL)
                    && !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)) {
                    throw new Error('系统管理员不能被系统管理员封禁');
                }
            }
        }
        let ok = 0;
        const failed = [];
        const banned = [];
        for (const uid of ids) {
            try {
                if (action === 'ban') {
                    auth.banUserGlobally(uid, form.reason || '', until, user.id);
                    banned.push(uid);
                } else {
                    auth.unbanUserGlobally(uid);
                }
                ok++;
            } catch (e) {
                failed.push(uid + ': ' + e.message);
            }
        }
        for (const uid of banned) {
            try { websocket.kickFromAllDomains(uid, '你已被全局封禁'); } catch (e) {}
        }
        const note = failed.length
            ? `，失败 ${failed.length} 个：${failed[0]}` : '';
        flash.redirectWith(res, '/manage/users',
            (action === 'ban' ? '已封禁 ' : '已解封 ') + ok + ' 个用户' + note);
    } catch (e) {
        redirect(res, '/manage/users?error=' + encodeURIComponent(e.message));
    }
});
route('GET', '/manage/join_applications', ({ res, user }) => {
    const all = [];
    for (const dn of storage.listAllDomains()) {
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
    if (!user || !user.id) throw new UnauthorizedError();
    if (form.application_ids !== undefined) {
        const action = String(form.action || '');
        const picks = [];
        const seen = new Set();
        try {
            if (action !== 'approve' && action !== 'reject') throw new Error('未知批量操作');
            for (const raw of String(form.application_ids || '').split(',')) {
                const value = raw.trim();
                const pos = value.indexOf(':');
                if (pos <= 0 || pos === value.length - 1) continue;
                const dn = value.slice(0, pos);
                const uid = value.slice(pos + 1);
                if (seen.has(value)) continue;
                if (picks.length >= 200) throw new Error('一次最多选择 200 个申请');
                seen.add(value);
                picks.push({ dn, uid });
            }
            if (!picks.length) throw new Error('没有选择申请');
            const groups = new Map();
            for (const pick of picks) {
                if (!groups.has(pick.dn)) groups.set(pick.dn, new Set());
                groups.get(pick.dn).add(pick.uid);
            }
            const prepared = [];
            for (const [dn, uids] of groups) {
                if (!storage.domainExists(dn)) throw new Error('域不存在：' + dn);
                checkDual(user, auth.getDomainUser(dn, user), 'manage_user');
                const domain = storage.loadDomain(dn);
                const apps = Array.isArray(domain.join_applications)
                    ? domain.join_applications : [];
                for (const uid of uids) {
                    const app = apps.find(a => a.uid === uid);
                    if (!app) throw new Error('申请不存在：' + uid);
                    if (action === 'approve' && auth.isUserBannedInDomain(domain, uid)) {
                        throw new Error('用户 ' + (app.nickname || uid) + ' 已被封禁');
                    }
                }
                prepared.push({
                    dn, domain, uids,
                    original: JSON.parse(JSON.stringify(domain)),
                });
            }
            let total = 0;
            const saved = [];
            const messages = [];
            try {
                for (const item of prepared) {
                    const apps = Array.isArray(item.domain.join_applications)
                        ? item.domain.join_applications : [];
                    const remain = [];
                    if (!item.domain.members) item.domain.members = {};
                    for (const app of apps) {
                        if (!item.uids.has(app.uid)) { remain.push(app); continue; }
                        if (action === 'approve') {
                            item.domain.members[app.uid] = {
                                role: 'default', level: 0, exp: 0,
                                joined_at: storage.nowIso(),
                            };
                        }
                        messages.push({
                            uid: app.uid,
                            text: `你加入「${item.domain.display_name || item.dn}」的申请`
                                + (action === 'approve' ? '已通过' : '被拒绝'),
                        });
                        total++;
                    }
                    item.domain.join_applications = remain;
                    storage.saveDomain(item.dn, item.domain);
                    saved.push(item);
                }
            } catch (e) {
                for (const item of saved.reverse()) {
                    try { storage.saveDomain(item.dn, item.original); } catch (e2) {}
                }
                throw e;
            }
            for (const m of messages) {
                try { auth.sendSystemDM(m.uid, m.text); } catch (e) {}
            }
            if (action === 'approve') {
                for (const item of saved) websocket.broadcastMembersUpdate(item.dn);
            }
            flash.redirectWith(res, '/manage/join_applications',
                (action === 'approve' ? '已通过 ' : '已拒绝 ') + total + ' 条申请');
        } catch (e) {
            redirect(res, '/manage/join_applications?error=' + encodeURIComponent(e.message));
        }
        return;
    }
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
        flash.redirectWith(res, '/manage/join_applications', okMsg);
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
route('POST', '/create/domain', ({ res, user, form, req }) => {
    const cfg = storage.loadDomain('system').system_config || {};
    checkPriv(user, 'base', PRIV.BASE.CREATE_DOMAIN);
    const limiter = require('../rate-limit');
    const limited = limiter.check('create_domain', {
        ip: (req && req._clientIp) || '',
        account: user.id,
    });
    if (limited) {
        return require('../template').alertBack(res,
            require('./_helpers').limitMessage('创建域', limited));
    }
    limiter.note('create_domain', {
        ip: (req && req._clientIp) || '',
        account: user.id,
    });
    const owned = storage.listAllDomains().filter(dn => storage.loadDomain(dn).owner_id === user.id);
    if (owned.length >= (cfg.max_domains_per_user || 5)) return require('../template').alertBack(res, '已达最大域数');
    try {
        const name = (form.name || '').trim();
        storage.createDomain(name, (form.display_name || name).trim(), user.id);
        flash.redirectWith(res, `/domain/${name}/home`, '域已创建');
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

'use strict';
const storage = require('../storage');
const { route } = require('../router');
const { render } = require('../template');
const { redirect, buildNav } = require('./_helpers');
const { PRIV, hasPriv } = require('../permissions');
const { buildUserList } = require('./_helpers');

route('GET', '/', ({ res }) => redirect(res, '/home'));
route('GET', '/discuss', ({ res }) => redirect(res, '/domain/system/discuss'));
route('GET', '/files', ({ res }) => redirect(res, '/domain/system/files'));

route('GET', '/home', ({ res, user }) => {
    const auth = require('../auth');
    const { checkPerm } = require('../auth/privilege');
    const { PERM } = require('../permissions');
    checkPerm(auth.getDomainUser('system', user), PERM.GENERAL.VIEW);
    render(res, 'home.html', buildHomeData('system', user));
});

function withSiteName(data, target) {
    const sysCfg = storage.loadDomain('system').system_config || {};
    if (target && typeof target === 'object') {
        Object.assign(target, { site_name: sysCfg.site_name || '离线聊天室' });
        return target;
    }
    return Object.assign({ site_name: sysCfg.site_name || '离线聊天室' }, data);
}

route('GET', '/users', ({ res, user }) => {
    const users = storage.listRealUsers().map(u => ({
        id: u.id, nickname: u.nickname || '?',
avatar_color: u.avatar_color || '#888', avatar_ext: u.avatar_ext || '',
            online: storage.isOnlineAnywhere(u.id),
        is_superuser: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_ALL),
        is_admin: hasPriv(u, 'system', PRIV.SYSTEM.MANAGE_PANEL),
        bio: u.bio || '', level: 0, exp: 0, role: '',
    }));
    render(res, 'users.html', withSiteName({
        is_domain_view: false,
        current_user: user || {},
        nav: buildNav(user),
        users,
    }));
});

function buildHomeData(dn, user) {
    const auth = require('../auth');
    const domain = storage.loadDomain(dn);
    const du = auth.getDomainUser(dn, user);

    const announcements = [];
    for (const m of storage.loadAllMessages(dn, 'announce')) {
        if (m.pinned && !m.deleted) {
            announcements.push({
                content: m.content, nickname: m.nickname,
                created_at: m.created_at, is_system: !!m.is_system,
            });
        }
    }
    const discussions = [];
    for (const id of storage.listDiscussions(dn)) {
        const cfg = storage.loadDiscussion(dn, id);
        const count = storage.loadAllMessages(dn, id).filter(m => !m.deleted).length;
        discussions.push({ id, title: cfg.title || '', reply_count: count });
    }
    const users = buildUserList(dn);
    const onlineCount = users.filter(u => u.online).length;
    const sysCfg = storage.loadDomain('system').system_config || {};

    return withSiteName({
        domain_name: dn,
        display_name: domain.display_name || dn,
        announcement: domain.announcement || '',
        site_name: sysCfg.site_name || '离线聊天室',
        site_announcement: sysCfg.site_announcement || '',
        announcements, discussions, users,
        online_count: onlineCount, total_count: users.length,
        is_member: du.is_member,
        join_policy: domain.join_policy || 'open',
        current_user: user || {},
        nav: buildNav(user, dn),
    });
}

module.exports = { buildHomeData, withSiteName };
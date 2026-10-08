'use strict';
const storage = require('../storage');
const { route } = require('../router');
const { render, render403, render404, alertBack } = require('../template');
const { redirect, deny401, buildNav } = require('./_helpers');
const { withSiteName } = require('./home');
const { validateNickname } = require('../storage/nickname-rules');

const DM_POLICY_LABELS = {
    'everyone': '接受所有人私信（拉黑除外）',
    'mutual': '仅接受互相关注的人与管理员',
    'following': '仅接受我关注的人与管理员',
    'admin': '仅接受管理员私信',
};

route('GET', '/user/:uid', ({ res, user, params, query }) => {
    const target = storage.loadUser(params.uid);
    if (!target.id) return render404(res);
    if (target.is_system) { res.writeHead(404); res.end(); return; }

    const counts = storage.getFollowCounts(target.id);
    const isFollowingMe = user && user.id ? storage.isFollowing(user.id, target.id) : false;
    const isFollowedByMe = user && user.id ? storage.isFollowing(target.id, user.id) : false;
    const isBlocked = user && user.id ? storage.isBlocked(user.id, target.id) : false;
    const isBlockedBy = user && user.id ? storage.isBlocked(target.id, user.id) : false;
    const policy = target.dm_policy || 'everyone';

    render(res, 'profile.html', withSiteName({
        current_user: user || {}, nav: buildNav(user),
        target,
        is_me: user && user.id === target.id,
        is_following: isFollowingMe,
        is_followed_by: isFollowedByMe,
        is_mutual: isFollowingMe && isFollowedByMe,
        is_blocked: isBlocked,
        is_blocked_by: isBlockedBy,
        followers_count: counts.followers,
        following_count: counts.following,
        dm_policy: policy,
        dm_policy_label: DM_POLICY_LABELS[policy] || '',
        error: query.error || '',
    }));
});

route('POST', '/user/:uid', ({ res, user, params, form }) => {
    if (!user || user.id !== params.uid) return render403(res, '你没有编辑此资料的权限');
    const u = storage.loadUser(user.id);
    let newNick;
    try {
        newNick = validateNickname(form.nickname || u.nickname);
    } catch (e) {
        return alertBack(res, e.message);
    }
    const existing = storage.findUserByNickname(newNick);
    if (existing && existing.id !== u.id) return alertBack(res, '昵称已被占用');
    const oldNick = u.nickname;
    u.nickname = newNick;
    u.bio = form.bio || '';
    storage.saveUser(u.id, u);
    if (oldNick !== newNick) storage.indexRename(oldNick, newNick, u.id);
    redirect(res, `/user/${u.id}`);
});

route('POST', '/user/:uid/follow', ({ res, user, params }) => {
    if (!user || !user.id) return deny401(res);
    if (user.id === params.uid) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('不能关注自己'));
    }
    if (!storage.follow(user.id, params.uid)) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('关注失败'));
    }
    redirect(res, `/user/${params.uid}`);
});

route('POST', '/user/:uid/unfollow', ({ res, user, params }) => {
    if (!user || !user.id) return deny401(res);
    storage.unfollow(user.id, params.uid);
    redirect(res, `/user/${params.uid}`);
});

function renderFollowList(res, user, targetUid, mode) {
    const target = storage.loadUser(targetUid);
    if (!target.id) return render404(res);
    const uids = mode === 'following' ? storage.getFollowing(targetUid) : storage.getFollowers(targetUid);
    const users = uids.map(uid => {
        const u = storage.loadUser(uid);
        if (!u.id || u.is_system) return null;
        return {
            id: uid, nickname: u.nickname || '?',
            avatar_color: u.avatar_color || '#888',
            bio: u.bio || '',
            online: storage.isOnlineAnywhere(uid),
            is_following: user && user.id ? storage.isFollowing(user.id, uid) : false,
        };
    }).filter(Boolean);
    render(res, 'follows.html', withSiteName({
        current_user: user || {}, nav: buildNav(user), target, mode, users,
    }));
}

route('GET', '/user/:uid/following', ({ res, user, params }) =>
    renderFollowList(res, user, params.uid, 'following'));
route('GET', '/user/:uid/followers', ({ res, user, params }) =>
    renderFollowList(res, user, params.uid, 'followers'));

route('POST', '/user/:uid/block', ({ res, user, params }) => {
    if (!user || !user.id) return deny401(res);
    if (user.id === params.uid) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('不能拉黑自己'));
    }
    if (!storage.blockUser(user.id, params.uid)) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('拉黑失败'));
    }
    redirect(res, `/user/${params.uid}`);
});

route('POST', '/user/:uid/unblock', ({ res, user, params }) => {
    if (!user || !user.id) return deny401(res);
    storage.unblockUser(user.id, params.uid);
    redirect(res, `/user/${params.uid}`);
});

// 安全设置
route('GET', '/settings/security', ({ res, user }) => {
    if (!user || !user.id) return deny401(res);
    render(res, 'settings_security.html', withSiteName({ current_user: user, nav: buildNav(user) }));
});
route('POST', '/settings/security/password', ({ res, user, form }) => {
    if (!user || !user.id) return deny401(res);
    try {
        const newPwd = form.new_password || '';
        const confirmPwd = form.confirm_password || '';
        if (newPwd !== confirmPwd) throw new Error('两次输入的新密码不一致');
        require('../auth').changePassword(user.id, form.old_password || '', newPwd);
        require('../auth').destroyAllUserSessions(user.id);
        redirect(res, '/login');
    } catch (e) {
        alertBack(res, e.message);
    }
});
route('POST', '/settings/security/logout_all', ({ res, user }) => {
    if (!user || !user.id) return deny401(res);
    require('../auth').destroyAllUserSessions(user.id);
    redirect(res, '/login', { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
});
route('POST', '/settings/security/dm_policy', ({ res, user, form }) => {
    const { json, deny401 } = require('./_helpers');
    if (!user || !user.id) return json(res, 401, { ok: false, error: '未登录' });
    const policy = String(form.dm_policy || 'everyone');
    if (!['everyone', 'mutual', 'following', 'admin'].includes(policy)) {
        return json(res, 200, { ok: false, error: '无效的私信设置' });
    }
    const u = storage.loadUser(user.id);
    u.dm_policy = policy;
    storage.saveUser(user.id, u);
    json(res, 200, { ok: true });
});
'use strict';
const storage = require('../storage');
const { route } = require('../router');
const { render, render403, render404, alertBack } = require('../template');
const { redirect, buildNav } = require('./_helpers');
const { withSiteName } = require('./home');
const { validateNickname } = require('../storage/nickname-rules');
const { UnauthorizedError } = require('../auth/privilege');
const { canSetAvatar } = require('./avatar');
const avatar = require('../storage/avatar');
const { PRIV, hasPriv } = require('../permissions');
const { parseMultipart } = require('../http-utils');

const DM_POLICY_LABELS = {
    'everyone': '接受所有人私信（拉黑除外）',
    'mutual': '仅接受互相关注的人与管理员',
    'following': '仅接受关注我的人的私信',
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
        can_avatar: user && user.id === target.id && canSetAvatar(user),
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

route('POST', '/user/:uid', ({ res, user, params, form, req, rawBody }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (user.id !== params.uid) return render403(res, '你没有编辑此资料的权限');
    const u = storage.loadUser(user.id);
    let newNick;
    try {
        newNick = validateNickname(form.nickname || u.nickname);
    } catch (e) {
        return alertBack(res, e.message);
    }
    const existing = storage.findUserByNickname(newNick);
    if (existing && existing.id !== u.id) return alertBack(res, '昵称已被占用');

    // 头像随资料提交：有文件就换，avatar_remove=1 就删
    const avatarErr = applyAvatarFromProfile(user, u, req, rawBody);
    if (avatarErr) return alertBack(res, avatarErr);

    const oldNick = u.nickname;
    u.nickname = newNick;
    u.bio = form.bio || '';
    storage.saveUser(u.id, u);
    if (oldNick !== newNick) storage.indexRename(oldNick, newNick, u.id);
    redirect(res, `/user/${u.id}?ok=1`);
});

// 头像随资料提交：有文件就换，avatar_remove=1 就删。
// 返回错误文案，或把改动写到 u 上（不自己 save，避免被后面的 saveUser 覆盖）
function applyAvatarFromProfile(user, u, req, rawBody) {
    const ct = String(req.headers['content-type'] || '');
    if (!/multipart\/form-data/.test(ct)) return '';   // 普通表单提交就不动头像
    const bm = ct.match(/boundary=([^;]+)/);
    if (!bm) return '表单解析失败';

    const canSet = hasPriv(user, 'base', PRIV.BASE.UPLOAD_AVATAR);
    let file = null;
    let remove = '';
    try {
        // parseMultipart 返回以字段名为键的对象
        const parsed = parseMultipart(rawBody, bm[1].trim());
        file = parsed.avatar_file;
        remove = String((parsed.avatar_remove && parsed.avatar_remove.data) || '');
    } catch (e) {
        return '表单解析失败';
    }

    if (remove === '1') {
        if (!canSet) return '你没有修改头像的权限';
        avatar.clear(user.id);
        delete u.avatar_ext;
        return '';
    }
    if (!file || !file.data || !file.data.length) return '';   // 没选文件就不动
    if (!canSet) return '你没有上传头像的权限';
    const r = avatar.save(user.id, file.data);
    if (!r.ok) return r.error;
    u.avatar_ext = r.ext;      // save 只写文件，字段在这里落
    return '';
}

route('POST', '/user/:uid/follow', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (user.id === params.uid) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('不能关注自己'));
    }
    if (!storage.follow(user.id, params.uid)) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('关注失败'));
    }
    redirect(res, `/user/${params.uid}?ok=1`);
});

function requireOtherUser(res, uid) {
    if (!uid) return null;
    const t = storage.loadUser(uid);
    if (!t.id || t.is_system) {
        redirect(res, `/users?error=` + encodeURIComponent('用户不存在'));
        return null;
    }
    return t;
}

route('POST', '/user/:uid/unfollow', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!requireOtherUser(res, params.uid)) return;
    storage.unfollow(user.id, params.uid);
    redirect(res, `/user/${params.uid}?ok=1`);
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
            avatar_color: u.avatar_color || '#888', avatar_ext: u.avatar_ext || '',
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
    if (!user || !user.id) throw new UnauthorizedError();
    if (user.id === params.uid) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('不能拉黑自己'));
    }
    if (!storage.blockUser(user.id, params.uid)) {
        return redirect(res, `/user/${params.uid}?error=` + encodeURIComponent('拉黑失败'));
    }
    redirect(res, `/user/${params.uid}?ok=1`);
});

route('POST', '/user/:uid/unblock', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!requireOtherUser(res, params.uid)) return;
    storage.unblockUser(user.id, params.uid);
    redirect(res, `/user/${params.uid}?ok=1`);
});

// 安全设置
route('GET', '/settings/security', ({ res, user }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    render(res, 'settings_security.html', withSiteName({ current_user: user, nav: buildNav(user) }));
});
route('POST', '/settings/security/password', ({ res, user, form }) => {
    if (!user || !user.id) throw new UnauthorizedError();
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
    if (!user || !user.id) throw new UnauthorizedError();
    require('../auth').destroyAllUserSessions(user.id);
    redirect(res, '/login', { 'Set-Cookie': 'token=; Path=/; Max-Age=0' });
});
route('POST', '/settings/security/dm_policy', ({ res, user, form }) => {
    const { json } = require('./_helpers');
    if (!user || !user.id) throw new UnauthorizedError();
    const policy = String(form.dm_policy || 'everyone');
    if (!['everyone', 'mutual', 'following', 'admin'].includes(policy)) {
        return json(res, 200, { ok: false, error: '无效的私信设置' });
    }
    const u = storage.loadUser(user.id);
    u.dm_policy = policy;
    storage.saveUser(user.id, u);
    json(res, 200, { ok: true });
});

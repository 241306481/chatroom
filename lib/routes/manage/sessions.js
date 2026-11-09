'use strict';
const storage = require('../../storage');
const sessions = require('../../auth/sessions');
const websocket = require('../../websocket');
const logger = require('../../logger');
const { PRIV, hasPriv } = require('../../permissions');
const { route } = require('../../router');
const { render } = require('../../template');
const { buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { requireSystemAdmin } = require('./_helpers');
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtLeft(sec) {
    if (sec <= 0) return '已过期';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}
function canRevoke(actor, targetUid) {
    const target = storage.loadUser(targetUid);
    if (!target || !target.id) return { ok: true };
    if (target.is_system) return { ok: false, error: '不能强制系统账户下线' };
    if (String(actor.id) === String(targetUid)) return { ok: true };
    const actorAll = hasPriv(actor, 'system', PRIV.SYSTEM.MANAGE_ALL);
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_ALL) && !actorAll) {
        return { ok: false, error: '不能强制超级管理员下线' };
    }
    if (hasPriv(target, 'system', PRIV.SYSTEM.MANAGE_PANEL) && !actorAll) {
        return { ok: false, error: '系统管理员不能被系统管理员强制下线' };
    }
    return { ok: true };
}
function page(res, user, msg) {
    const users = new Map(storage.listAllUsers().map(u => [String(u.id), u]));
    const groups = new Map();
    for (const s of sessions.listSessions()) {
        if (s.expiresIn <= 0) continue;
        const key = String(s.uid);
        let group = groups.get(key);
        if (!group) {
            const target = users.get(key);
            group = {
                uid: key,
                nickname: target ? target.nickname : 'UID ' + key,
                can_revoke: canRevoke(user, key).ok,
                sessions: [],
            };
            groups.set(key, group);
        }
        group.sessions.push({
            ...s,
            created: fmtTime(s.createdAt),
            left: fmtLeft(s.expiresIn),
        });
    }
    const list = Array.from(groups.values());
    list.sort((a, b) => String(a.nickname).localeCompare(String(b.nickname)));
    render(res, 'manage_sessions.html', withSiteName({
        current_user: user, nav: buildNav(user), groups: list,
        ok: msg && msg.ok, err: msg && msg.err,
    }));
}
route('GET', '/manage/sessions', ({ res, user }) => {
    if (!requireSystemAdmin(user, res, 'sessions')) return;
    page(res, user);
}, { auth: true });
route('POST', '/manage/sessions', ({ req, res, user, form }) => {
    if (!requireSystemAdmin(user, res, 'sessions')) return;
    const ip = (req && req._clientIp) || '-';
    if (form.action === 'revoke') {
        const hit = sessions.findSessionBySid(form.sid);
        if (!hit) return page(res, user, { err: '会话不存在或已过期' });
        const check = canRevoke(user, hit.uid);
        if (!check.ok) return page(res, user, { err: check.error });
        sessions.destroySession(hit.token);
        try { websocket.closeSession(hit.token); } catch (e) {}
        logger.security('SESSION_REVOKED', ip,
            `uid=${hit.uid} by=${user.id} sid=${form.sid}`);
        return page(res, user, { ok: '会话已强制下线' });
    }
    if (form.action === 'revoke_user') {
        const uid = String(form.uid || '').trim();
        if (!/^\d+$/.test(uid)) return page(res, user, { err: '用户参数无效' });
        const check = canRevoke(user, uid);
        if (!check.ok) return page(res, user, { err: check.error });
        const count = sessions.destroyAllUserSessions(uid);
        try { websocket.closeUser(uid); } catch (e) {}
        logger.security('SESSION_REVOKED_ALL', ip,
            `uid=${uid} by=${user.id} count=${count}`);
        return page(res, user, { ok: `已强制下线 ${count} 个会话` });
    }
    return page(res, user, { err: '未知操作' });
}, { auth: true });

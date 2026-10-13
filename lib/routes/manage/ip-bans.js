'use strict';

const ipBans = require('../../storage/ip-bans');
const userIps = require('../../storage/user-ips');
const storage = require('../../storage');
const { route } = require('../../router');
const { render, render403, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, hasPriv } = require('../../permissions');

function requireSystemAdmin(user, res) {
    if (!user || !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        render403(res, '仅系统管理员可访问');
        return false;
    }
    return true;
}

// ============================================================
// IP 封禁管理
// ============================================================
route('GET', '/manage/ip_bans', ({ res, user }) => {
    if (!requireSystemAdmin(user, res)) return;
    render(res, 'manage_ip_bans.html', withSiteName({
        current_user: user, nav: buildNav(user),
        list: ipBans.listAll(),
    }));
}, { auth: true });

route('POST', '/manage/ip_bans', ({ res, user, form }) => {
    if (!requireSystemAdmin(user, res)) return;

    if (form.action === 'add') {
        const rule = String(form.rule || '').trim();
        if (!rule) return alertBack(res, '请输入 IP 规则');
        try {
            ipBans.addBan(rule, {
                reason: form.reason || '',
                until: form.until || '',
                by: user.id,
            });
            return redirect(res, '/manage/ip_bans?ok=' + encodeURIComponent('已添加规则 ' + rule));
        } catch (e) {
            return alertBack(res, e.message);
        }
    }

    if (form.action === 'remove') {
        const rule = String(form.rule || '').trim();
        if (!rule) return alertBack(res, '缺少规则');
        const n = ipBans.removeByRule(rule);
        const msg = n > 0 ? ('已删除规则 ' + rule) : ('未找到规则 ' + rule);
        return redirect(res, '/manage/ip_bans?ok=' + encodeURIComponent(msg));
    }

    return redirect(res, '/manage/ip_bans');
}, { auth: true });

// ============================================================
// 用户最近 IP
// ============================================================
route('GET', '/manage/user_ips', ({ res, user }) => {
    if (!requireSystemAdmin(user, res)) return;
    const users = storage.listRealUsers().map((u) => ({
        id: u.id,
        nickname: u.nickname || '?',
        ips: userIps.load(u.id),
    })).filter((u) => u.ips.length > 0);
    render(res, 'manage_user_ips.html', withSiteName({
        current_user: user, nav: buildNav(user), users,
    }));
}, { auth: true });
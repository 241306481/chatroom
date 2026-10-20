'use strict';

const ipBans = require('../../storage/ip-bans');
const userIps = require('../../storage/user-ips');
const storage = require('../../storage');
const websocket = require('../../websocket');
const { route } = require('../../router');
const { render } = require('../../template');
const { buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { requireSystemAdmin } = require('./_helpers');

// 统一出口：直接重渲染，不重定向
function page(res, user, msg, back, clientIp) {
    const list = ipBans.listAll().map((r) => ({
        ...r,
        expired: ipBans.isExpired(r),
        until_local: toLocalInput(r.until),
        // 命中自己：不拦，但要显眼
        hits_self: !!clientIp && ipBans.matchRule(clientIp, r.rule),
    }));
    render(res, 'manage_ip_bans.html', withSiteName({
        current_user: user, nav: buildNav(user),
        list, ok: msg && msg.ok, err: msg && msg.err, back: back || '',
        my_ip: clientIp || '',
    }));
}

// ISO -> datetime-local；空值=永久
function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
        + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// IP 封禁管理
route('GET', '/manage/ip_bans', ({ res, user, form, query, req }) => {
    if (!requireSystemAdmin(user, res, 'ip_bans')) return;
    page(res, user, { ok: query.ok, err: query.error }, query.back, req._clientIp || '');
}, { auth: true });

route('POST', '/manage/ip_bans', ({ res, user, form, req }) => {
    if (!requireSystemAdmin(user, res, 'ip_bans')) return;
    const back = String(form.back || '').trim();
    const me = req._clientIp || '';
    const page_ = (msg) => page(res, user, msg, back, me);

    if (form.action === 'add') {
        const rule = String(form.rule || '').trim();
        if (!rule) return page_({ err: '请输入 IP 规则' });
        try {
            ipBans.addBan(rule, {
                reason: form.reason || '',
                until: form.until || '',
                by: user.id,
            });
            const kicked = websocket.kickByIpRule(rule, '你的 IP 已被封禁');
            const selfHit = ipBans.isBanned(req._clientIp || '');
            return page_({
                err: selfHit ? '⚠ 规则已添加，但它命中了你自己所在网段，可能无法再登录解除' : null,
                ok: '已添加规则 ' + rule + (kicked > 0 ? '，已断开 ' + kicked + ' 个在线连接' : ''),
            });
        } catch (e) {
            return page_({ err: e.message });
        }
    }

    if (form.action === 'remove') {
        const rule = String(form.rule || '').trim();
        if (!rule) return page_({ err: '缺少规则' });
        const n = ipBans.removeByRule(rule);
        return page_({ ok: n > 0 ? ('已解除规则 ' + rule) : ('未找到规则 ' + rule) });
    }

    if (form.action === 'set_until') {
        const rule = String(form.rule || '').trim();
        try {
            ipBans.setUntil(rule, form.until || '');
            const kicked = websocket.kickByIpRule(rule, '你的 IP 封禁时长已变更');
            return page_({
                ok: '已更新 ' + rule + ' 的到期时间' + (kicked > 0 ? '，断开 ' + kicked + ' 个连接' : ''),
            });
        } catch (e) {
            return page_({ err: e.message });
        }
    }

    return page_(null);
}, { auth: true });

// 用户最近 IP
route('GET', '/manage/user_ips', ({ res, user }) => {
    if (!requireSystemAdmin(user, res, 'user_ips')) return;
    const banned = new Set(ipBans.listAll().map((r) => r.rule));
    const users = storage.listRealUsers().map((u) => ({
        id: u.id,
        nickname: u.nickname || '?',
        ips: userIps.load(u.id).map((r) => ({
            ip: r.ip,
            at: r.at,
            // 未过期才算当前被封
            banned: !!ipBans.isBanned(r.ip),
            // 通配规则无法逐条对应，只提示相关
            covered: banned.has(r.ip) ? false : [...banned].some((x) => ipBans.matchRule(r.ip, x)),
        })),
    })).filter((u) => u.ips.length > 0);
    render(res, 'manage_user_ips.html', withSiteName({
        current_user: user, nav: buildNav(user), users,
    }));
}, { auth: true });
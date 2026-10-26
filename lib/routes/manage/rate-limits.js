'use strict';
const limiter = require('../../rate-limit');
const sessions = require('../../auth/sessions');
const storage = require('../../storage');
const { route } = require('../../router');
const { render } = require('../../template');
const { buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { requireSystemAdmin } = require('./_helpers');
function page(res, user, msg) {
    const config = limiter.listConfig();
    const live = limiter.snapshot();
    const bind = sessions.getBindConfig();
    const actions = config.map((c) => {
        const per = live[c.action] || {};
        const top = [];
        for (const [dim, list] of Object.entries(per)) {
            for (const item of list) {
                top.push({ dim, key: item.key, n: item.n, secsLeft: item.secsLeft });
            }
        }
        top.sort((a, b) => b.n - a.n);
        return { ...c, live: top.slice(0, 8) };
    });
    render(res, 'manage_rate_limits.html', withSiteName({
        current_user: user, nav: buildNav(user),
        actions, bind,
        ok: msg && msg.ok, err: msg && msg.err,
        sessionCount: sessions.listSessions().length,
    }));
}
route('GET', '/manage/rate_limits', ({ res, user, query }) => {
    if (!requireSystemAdmin(user, res, 'rate_limits')) return;
    page(res, user, { ok: query.ok, err: query.error });
}, { auth: true });
route('POST', '/manage/rate_limits', ({ res, user, form }) => {
    if (!requireSystemAdmin(user, res, 'rate_limits')) return;
    if (form.action === 'reset') {
        limiter.resetCounters(form.target || '');
        return page(res, user, { ok: '计数已清空' });
    }
    if (form.action === 'save') {
        const list = [];
        for (const key of Object.keys(form)) {
            if (!key.startsWith('cfg_')) continue;
            const action = key.substring(4);
            list.push({
                action,
                label: form['label_' + action] || action,
                windowMin: form['window_' + action],
                perIp: form['ip_' + action],
                perAccount: form['acct_' + action],
                perAccount: form['acct_' + action],
            });
        }
        const okSave = limiter.saveConfig(list);
        if (!okSave) return page(res, user, { err: '保存失败' });
        return page(res, user, { ok: '已保存' });
    }
    if (form.action === 'save_bind') {
        let domain;
        try { domain = storage.loadDomain('system'); } catch (e) { return page(res, user, { err: '保存失败' }); }
        if (!domain) return page(res, user, { err: '保存失败' });
        if (!domain.system_config) domain.system_config = {};
        domain.system_config.session_bind_ua = form.bind_ua === '1';
        const m = parseInt(form.max_ips, 10);
        domain.system_config.session_max_ips = (isNaN(m) || m < 1) ? 5 : m;
        const u = parseInt(form.max_uas, 10);
        domain.system_config.session_max_uas = (isNaN(u) || u < 1) ? 3 : u;
        try { storage.saveDomain('system', domain); } catch (e) { return page(res, user, { err: '保存失败' }); }
        return page(res, user, { ok: '已保存' });
    }
    return page(res, user, {});
}, { auth: true });

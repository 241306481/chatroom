'use strict';
const storage = require('../../storage');
const auth = require('../../auth');
const sysRoles = require('../../storage/system-roles');
const { route } = require('../../router');
const { render, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, PRIV_NAMES = [], SYSTEM_ROLES_BUILTIN, hasPriv } = require('../../permissions');
const { UnauthorizedError, PrivilegeError } = require('../../auth/privilege');

route('GET', '/manage/system_roles', ({ res }) => {
    redirect(res, '/manage/permissions');
});

route('GET', '/manage/permissions', ({ res, user }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM)) throw new PrivilegeError('仅系统管理员可访问');
    const all = sysRoles.loadRoles();
    const roles = Object.entries(all).map(([name, r]) => ({
        name, display: r.display, priv: r.priv || 0,
        editable: !!r.editable, builtin: !!r.builtin,
    }));
    for (const r of roles) {
        r.bitMap = {};
        for (const p of PRIV_NAMES) r.bitMap['b' + p.bit] = (r.priv & p.bit) !== 0;
    }
    const groups = {};
    for (const p of PRIV_NAMES) {
        if (!groups[p.group]) groups[p.group] = [];
        groups[p.group].push({ bit: p.bit, key: 'b' + p.bit, name: p.name });
    }
    render(res, 'manage_system_permission.html', withSiteName({
        current_user: user, nav: buildNav(user), roles, groups,
    }));
});

route('POST', '/manage/permissions', ({ res, user, form }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM)) throw new PrivilegeError('仅系统管理员可访问');
    for (const key of Object.keys(form)) {
        if (!key.startsWith('perm_')) continue;
        const roleName = key.substring(5);
        const builtin = SYSTEM_ROLES_BUILTIN[roleName];
        const priv = parseInt(form[key] || '0', 10) >>> 0;

        if (builtin) {
            if (!builtin.editable) continue;
            const sysDomain = storage.loadDomain('system');
            if (!sysDomain.system_role_privs) sysDomain.system_role_privs = {};
            sysDomain.system_role_privs[roleName] = priv;
            storage.saveDomain('system', sysDomain);
            sysRoles.invalidateCache();
            continue;
        }
        if (!sysRoles.roleExists(roleName)) continue;
        const cur = sysRoles.loadRoles()[roleName];
        sysRoles.saveSystemRole(roleName, { display: cur.display, priv });
    }
    redirect(res, '/manage/permissions');
});

'use strict';
const sysRoles = require('../../storage/system-roles');
const storage = require('../../storage');
const { route } = require('../../router');
const { render, render403, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, PRIV_NAMES, SYSTEM_ROLES_BUILTIN, hasPriv } = require('../../permissions');

function requireSystemAdmin(user, res) {
    if (!user || !hasPriv(user.priv || 0, PRIV.MANAGE_SYSTEM)) {
        render403(res, '仅系统管理员可访问');
        return false;
    }
    return true;
}

// 角色列表页
route('GET', '/manage/system_roles', ({ res, user }) => {
    if (!requireSystemAdmin(user, res)) return;
    const all = sysRoles.loadRoles();
    const roles = Object.entries(all).map(([name, r]) => ({
        name, display: r.display,
        builtin: !!r.builtin, editable: !!r.editable,
    }));
    render(res, 'manage_system_role.html', withSiteName({
        current_user: user, nav: buildNav(user), roles,
    }));
});

// 创建 / 删除
route('POST', '/manage/system_roles', ({ res, user, form }) => {
    if (!requireSystemAdmin(user, res)) return;
    if (form.action === 'create') {
        const name = String(form.role_name || '').trim();
        if (!/^[a-z0-9_-]+$/.test(name)) {
            return alertBack(res, '角色名只能含小写字母、数字、下划线、短横线');
        }
        if (name.length < 2 || name.length > 32) {
            return alertBack(res, '角色名长度需为 2-32 位，当前 ' + name.length + ' 位');
        }
        if (sysRoles.roleExists(name)) return alertBack(res, '角色已存在');
        sysRoles.createRole(name, form.display || name);
    } else if (form.action === 'delete') {
        const name = String(form.role_name || '');
        if (SYSTEM_ROLES_BUILTIN[name]) return render403(res, '内置角色不可删除');
        const inUse = storage.listRealUsers().some(u => u.system_role === name);
        if (inUse) return alertBack(res, '该角色正在被用户使用，请先转移这些用户的角色');
        sysRoles.deleteRole(name);
    }
    redirect(res, '/manage/system_roles');
});

// 权限矩阵
route('GET', '/manage/permissions', ({ res, user }) => {
    if (!requireSystemAdmin(user, res)) return;
    const all = sysRoles.loadRoles();
    const roles = Object.entries(all).map(([name, r]) => ({
        name, display: r.display, priv: r.priv || 0, editable: !!r.editable,
    }));
    for (const r of roles) {
        r.bitMap = {};
        for (const p of PRIV_NAMES) r.bitMap['b' + p.bit] = (r.priv & p.bit) !== 0;
    }
    const groups = {};
    for (const p of PRIV_NAMES) {
        if (!groups[p.group]) groups[p.group] = [];
        groups[p.group].push({ bit: p.bit, key: 'b' + p.bit, name: p.name, desc: p.desc || '' });
    }
    render(res, 'manage_system_permission.html', withSiteName({
        current_user: user, nav: buildNav(user), roles, groups,
    }));
});

route('POST', '/manage/permissions', ({ res, user, form }) => {
    if (!requireSystemAdmin(user, res)) return;
    for (const key of Object.keys(form)) {
        if (!key.startsWith('perm_')) continue;
        const roleName = key.substring(5);
        const builtin = SYSTEM_ROLES_BUILTIN[roleName];
        if (builtin && !builtin.editable) continue;
        const priv = parseInt(form[key] || '0', 10) >>> 0;
        sysRoles.saveRolePriv(roleName, priv);
    }
    redirect(res, '/manage/permissions');
});
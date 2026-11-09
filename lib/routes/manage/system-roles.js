'use strict';
const sysRoles = require('../../storage/system-roles');
const flash = require('../../flash');
const storage = require('../../storage');
const { route } = require('../../router');
const { render, render403, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, PRIV_GROUPS, SYSTEM_ROLES_BUILTIN, hasPriv } = require('../../permissions');
const { requireSystemAdmin } = require('./_helpers');
route('GET', '/manage/system_roles', ({ res, user }) => {
    if (!requireSystemAdmin(user, res, 'system_roles')) return;
    const all = sysRoles.loadRoles();
    const roles = Object.entries(all).map(([name, r]) => ({
        name, display: r.display,
        builtin: !!r.builtin, editable: !!r.editable,
    }));
    render(res, 'manage_system_role.html', withSiteName({
        current_user: user, nav: buildNav(user), roles,
    }));
});
route('POST', '/manage/system_roles', ({ res, user, form }) => {
    if (!requireSystemAdmin(user, res, 'system_roles')) return;
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
    } else {
        return alertBack(res, '未知操作');
    }
    flash.redirectWith(res, '/manage/system_roles', '操作成功');
});
route('GET', '/manage/permissions', ({ res, user }) => {
    if (!requireSystemAdmin(user, res, 'permissions')) return;
    const all = sysRoles.loadRoles();
    const roles = Object.entries(all).map(([name, r]) => ({
        name, display: r.display, privs: r.privs || {}, editable: !!r.editable,
    }));
    const groups = {};
    const GROUP_ORDER = ['base', 'system', 'discuss', 'message', 'file', 'member', 'domain'];
    for (const g of GROUP_ORDER) {
        groups[g] = { label: '', items: [] };
    }
    for (const p of PRIV_GROUPS) {
        if (!groups[p.group]) groups[p.group] = { label: p.groupLabel, items: [] };
        groups[p.group].label = p.groupLabel;
        groups[p.group].items.push(p);
    }
    for (const r of roles) {
        r.bitMap = {};
        for (const p of PRIV_GROUPS) {
            r.bitMap[p.key] = (r.privs[p.group] & p.bit) !== 0;
        }
    }
    render(res, 'manage_system_permission.html', withSiteName({
        current_user: user, nav: buildNav(user), roles, groups,
    }));
});
route('POST', '/manage/permissions', ({ res, user, form }) => {
    if (!requireSystemAdmin(user, res, 'permissions')) return;
    const allRoles = sysRoles.loadRoles();
    const VALID_GROUPS = new Set([
        'base', 'system', 'discuss', 'message', 'file', 'member', 'domain',
    ]);
    const rolePrivsUpdate = Object.create(null);
    for (const key of Object.keys(form)) {
        if (!key.startsWith('priv_')) continue;
        const rest = key.substring(5);
        const dot = rest.lastIndexOf('.');
        if (dot < 0) continue;
        const roleName = rest.substring(0, dot);
        const group = rest.substring(dot + 1);
        if (!VALID_GROUPS.has(group)) continue;
        if (!Object.prototype.hasOwnProperty.call(allRoles, roleName)) continue;
        if (!rolePrivsUpdate[roleName]) {
            rolePrivsUpdate[roleName] = { ...allRoles[roleName].privs };
        }
        rolePrivsUpdate[roleName][group] = parseInt(form[key] || '0', 10) >>> 0;
    }
    const actorPrivs = (user && user.privs) || {};
    const actorSuper = hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL);
    for (const [roleName, privs] of Object.entries(rolePrivsUpdate)) {
        const builtin = SYSTEM_ROLES_BUILTIN[roleName];
        if (builtin && !builtin.editable) continue;
        if (!actorSuper) {
            const old = (allRoles[roleName] && allRoles[roleName].privs) || {};
            for (const group of VALID_GROUPS) {
                const oldMask = (Number(old[group]) || 0) >>> 0;
                const newMask = (Number(privs[group]) || 0) >>> 0;
                const added = (newMask & ~oldMask) >>> 0;
                const actorMask = (Number(actorPrivs[group]) || 0) >>> 0;
                const extra = (added & ~actorMask) >>> 0;
                if (extra) {
                    return alertBack(res,
                        '不能授予自己不具备的权限（' + group + ' 权限位 ' + extra + '）');
                }
            }
        }
        sysRoles.saveRolePrivs(roleName, privs);
    }
    flash.redirectWith(res, '/manage/permissions', '操作成功');
});

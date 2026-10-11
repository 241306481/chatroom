'use strict';
const sysRoles = require('../../storage/system-roles');
const storage = require('../../storage');
const { route } = require('../../router');
const { render, render403, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PRIV, PRIV_GROUPS, SYSTEM_ROLES_BUILTIN, hasPriv } = require('../../permissions');

function requireSystemAdmin(user, res) {
    if (!user || !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
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
        name, display: r.display, privs: r.privs || {}, editable: !!r.editable,
    }));
    // 按组分装
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
    // 每个角色的每个权限，预计算 bitMap
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
    if (!requireSystemAdmin(user, res)) return;
    // 字段名格式：priv_<roleName>.<group>，值为该组的十进制位掩码
    // 例：priv_admin.system = 31
    const allRoles = sysRoles.loadRoles();
    const rolePrivsUpdate = {};

    for (const key of Object.keys(form)) {
        if (!key.startsWith('priv_')) continue;
        const rest = key.substring(5);           // "<roleName>.<group>"
        const dot = rest.lastIndexOf('.');
        if (dot < 0) continue;
        const roleName = rest.substring(0, dot);
        const group = rest.substring(dot + 1);
        if (!rolePrivsUpdate[roleName]) {
            rolePrivsUpdate[roleName] = { ...(allRoles[roleName] ? allRoles[roleName].privs : {}) };
        }
        rolePrivsUpdate[roleName][group] = parseInt(form[key] || '0', 10) >>> 0;
    }

    for (const [roleName, privs] of Object.entries(rolePrivsUpdate)) {
        const builtin = SYSTEM_ROLES_BUILTIN[roleName];
        if (builtin && !builtin.editable) continue;
        sysRoles.saveRolePrivs(roleName, privs);
    }
    redirect(res, '/manage/permissions');
});
'use strict';
const auth = require('../../auth');
const storage = require('../../storage');
const { route } = require('../../router');
const { render, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PERM_NAMES, BUILTIN_ROLES } = require('../../permissions');
const { UnauthorizedError, PrivilegeError, checkDual } = require('../../auth/privilege');

route('GET', '/domain/:domain_name/manage/role', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!auth.canManageDomain(user, dn)) throw new PrivilegeError('你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    const roles = [];

    for (const [name, role] of Object.entries(BUILTIN_ROLES)) {
        roles.push({ name, display: role.display, editable: role.editable, builtin: true });
    }
    if (domain.roles) {
        for (const [name, role] of Object.entries(domain.roles)) {
            roles.push({ name, display: role.display || name, editable: true, builtin: false });
        }
    }
    render(res, 'manage_role.html', withSiteName({
        current_user: user, nav: buildNav(user, dn), domain_name: dn, roles,
    }));
});

route('POST', '/domain/:domain_name/manage/role', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'manage_role');
    const domain = storage.loadDomain(dn);
    if (!domain.roles) domain.roles = {};

    if (form.action === 'create') {
        if (!/^[a-z0-9_-]{2,32}$/.test(form.role_name)) {
            return alertBack(res, '角色名只能含小写字母、数字、下划线、短横线（2-32 位）');
        }
        if (BUILTIN_ROLES[form.role_name] || domain.roles[form.role_name]) {
            return alertBack(res, '角色已存在');
        }
        domain.roles[form.role_name] = {
            display: form.display || form.role_name, perm: 0,
        };
    } else if (form.action === 'delete') {
        if (BUILTIN_ROLES[form.role_name]) throw new PrivilegeError('内置角色不可删除');
        const inUse = Object.values(domain.members || {})
            .some(m => m.role === form.role_name);
        if (inUse) return alertBack(res, '该角色正在被成员使用，请先转移这些成员的角色');
        delete domain.roles[form.role_name];
    }
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/manage/role`);
});

route('GET', '/domain/:domain_name/manage/permission', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!auth.canManageDomain(user, dn)) throw new PrivilegeError('你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    const roles = [];

    for (const [name, role] of Object.entries(BUILTIN_ROLES)) {
        let perm = role.perm;
        if (domain.perm_overrides && domain.perm_overrides[name] !== undefined) {
            perm = domain.perm_overrides[name];
        }
        roles.push({ name, display: role.display, perm, editable: role.editable, builtin: true });
    }
    if (domain.roles) {
        for (const [name, role] of Object.entries(domain.roles)) {
            roles.push({
                name, display: role.display || name, perm: role.perm || 0,
                editable: true, builtin: false,
            });
        }
    }
    for (const r of roles) {
        r.bitMap = {};
        for (const p of PERM_NAMES) r.bitMap['b' + p.bit] = (r.perm & p.bit) !== 0;
    }
    const groups = {};
    for (const p of PERM_NAMES) {
        if (!groups[p.group]) groups[p.group] = [];
        groups[p.group].push({
            bit: p.bit, key: 'b' + p.bit,
            name: p.name, desc: p.desc || '',
        });
    }
    render(res, 'manage_permission.html', withSiteName({
        current_user: user, nav: buildNav(user, dn), domain_name: dn, roles, groups,
    }));
});

route('POST', '/domain/:domain_name/manage/permission', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'manage_role');
    const domain = storage.loadDomain(dn);
    if (!domain.perm_overrides) domain.perm_overrides = {};
    if (!domain.roles) domain.roles = {};

    for (const key of Object.keys(form)) {
        if (!key.startsWith('perm_')) continue;
        const roleName = key.substring(5);
        const perm = parseInt(form[key] || '0', 10) >>> 0;

        if (BUILTIN_ROLES[roleName]) {
            if (!BUILTIN_ROLES[roleName].editable) continue;
            domain.perm_overrides[roleName] = perm;
        } else if (domain.roles[roleName]) {
            domain.roles[roleName].perm = perm;
        }
    }
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/manage/permission`);
});

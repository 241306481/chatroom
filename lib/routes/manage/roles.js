'use strict';
const auth = require('../../auth');
const storage = require('../../storage');
const { route } = require('../../router');
const { render, alertBack } = require('../../template');
const { redirect, buildNav } = require('../_helpers');
const { withSiteName } = require('../home');
const { PERM_NAMES, BUILTIN_ROLES, expandPerm } = require('../../permissions');
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
    redirect(res, `/domain/${dn}/manage/role?ok=1`);
});

route('GET', '/domain/:domain_name/manage/permission', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!auth.canManageDomain(user, dn)) throw new PrivilegeError('你没有管理此域的权限');
    const domain = storage.loadDomain(dn);
    const roles = [];

    for (const [name, role] of Object.entries(BUILTIN_ROLES)) {
        let perm = role.perm;
        // 只有可编辑的内置角色才认 perm_overrides —— 与
        // auth.resolveRolePerm 的判定保持一致。root 是 locked(editable:false)，
        // 此前这里照样套用 override，页面会显示一个实际并不生效的权限。
        if (role.editable && domain.perm_overrides
            && domain.perm_overrides[name] !== undefined) {
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

    // 「能管理角色」不等于「能凭空造出自己都没有的权限」。
    // 若不设上限，一个只持有 MANAGE_ROLE 的版主提交 perm_default=<PERM.ALL>
    // 就能让全体 default 成员瞬间获得 MANAGE_USER / KICK / EDIT_DOMAIN /
    // DELETE_DISCUSSION —— 直接绕过权限体系完成域内提权。
    // 因此只允许授予自己在本域已实际持有的位（与 canGrantRole
    // 「只有所有者/超管才能授予 root」是同一类防提权约束）。
    const allowed = expandPerm(du.perm || 0);

    for (const key of Object.keys(form)) {
        if (!key.startsWith('perm_')) continue;
        const roleName = key.substring(5);
        const perm = parseInt(form[key] || '0', 10) >>> 0;

        if (perm & ~allowed) {
            return alertBack(res,
                '不能授予你自己不具备的权限（超出 0x'
                + (perm & ~allowed).toString(16) + '）');
        }

        if (BUILTIN_ROLES[roleName]) {
            if (!BUILTIN_ROLES[roleName].editable) continue;
            domain.perm_overrides[roleName] = perm;
        } else if (domain.roles[roleName]) {
            domain.roles[roleName].perm = perm;
        }
    }
    storage.saveDomain(dn, domain);
    redirect(res, `/domain/${dn}/manage/permission?ok=1`);
});

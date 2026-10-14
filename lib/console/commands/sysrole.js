'use strict';
// 系统角色（全局 PRIV 角色）管理。
//
// Web 端有 /manage/system_roles 与 /manage/permissions。
// 控制台此前只有 `user admin` / `user deadmin`（直接改用户的 system_role 字段），
// 没有角色的增删改查 —— 也就是说「建一个只读审计员角色」在控制台做不到。
const sysRoles = require('../../storage/system-roles');
const storage = require('../../storage');
const { C, padR, privLabel } = require('../ui');

function usage(sub) {
    console.log(`${C.red}用法：sysrole ${sub}${C.reset}`);
}

// 控制台只读展示权限位，不提供直写。
// 与 `user priv` 同一理由：Web 的写入路径（system-roles.js 路由）带角色名
// 校验与原型防护，开放控制台直写等于绕过它。
const READONLY = true;

function list() {
    const roles = sysRoles.loadRoles();
    const names = Object.keys(roles);
    if (!names.length) { console.log(`${C.gray}（无系统角色）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('角色', 20) + padR('名称', 22) + padR('可编辑', 8)
        + padR('用户数', 8) + '权限摘要' + C.reset);
    console.log(`${C.gray}${'─'.repeat(96)}${C.reset}`);
    for (const name of names) {
        const r = roles[name] || {};
        const privs = r.privs || {};
        let holders = 0;
        for (const u of storage.listRealUsers()) {
            if ((u.system_role || '') === name) holders++;
        }
        console.log(
            padR(name, 20) +
            padR(storage.sliceChars(r.display || '—', 20), 22) +
            padR(r.editable === false ? '否' : '是', 8) +
            padR(String(holders), 8) +
            privLabel(privs)
        );
    }
    console.log(`${C.gray}共 ${names.length} 个系统角色${C.reset}`);
    if (READONLY) {
        console.log(`${C.yellow}  权限位只能在 Web 端 /manage/system_roles 修改`
            + `（控制台直写会绕过角色名校验与原型防护）${C.reset}`);
    }
}

function show(args) {
    const name = args[0];
    if (!name) { usage('show <role>'); return; }
    const roles = sysRoles.loadRoles();
    const r = roles[name];
    if (!r) {
        console.log(`${C.red}系统角色不存在：${name}${C.reset}`);
        console.log(`${C.gray}  现有：${Object.keys(roles).join(', ') || '（无）'}${C.reset}`);
        return;
    }
    console.log(`${C.bold}系统角色 ${name}${C.reset}`);
    console.log(`  显示名： ${r.display || '—'}`);
    console.log(`  可编辑： ${r.editable === false ? '否（内置）' : '是'}`);
    const privs = r.privs || {};
    console.log(`${C.bold}  权限位${C.reset}`);
    for (const group of Object.keys(privs).sort()) {
        const v = privs[group];
        if (typeof v !== 'number') continue;
        console.log('    ' + padR(group, 12) + '0x' + v.toString(16)
            + '  ' + `${C.gray}${'▮'.repeat(popcount(v))}${C.reset}`);
    }
}

function popcount(n) {
    let c = 0;
    while (n) { n &= n - 1; c++; }
    return c;
}

function members(args) {
    const name = args[0];
    if (!name) { usage('members <role>'); return; }
    if (!sysRoles.roleExists(name)) {
        console.log(`${C.red}系统角色不存在：${name}${C.reset}`);
        return;
    }
    const users = storage.listRealUsers().filter(u => (u.system_role || '') === name);
    if (!users.length) { console.log(`${C.gray}（该角色下没有用户）${C.reset}`); return; }
    console.log(`${C.bold}系统角色 ${name} 的成员（${users.length}）${C.reset}`);
    console.log(`${C.gray}${'─'.repeat(52)}${C.reset}`);
    for (const u of users) {
        console.log('  ' + padR(u.id, 8) + padR(storage.sliceChars(u.nickname || '?', 24), 26)
            + (u.banned ? `${C.red}已封禁${C.reset}` : ''));
    }
}

module.exports = { list, show, members };
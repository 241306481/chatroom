'use strict';
const storage = require('../../../storage');
const { C, padR } = require('../../ui');
const { BUILTIN_ROLES, bits } = require('../../../permissions');
function roles(args) {
    const name = args[0];
    if (!name) { console.log(`${C.red}用法：domain roles <name>${C.reset}`); return; }
    const d = storage.loadDomain(name);
    if (!d.name) { console.log(`${C.red}域 ${name} 不存在${C.reset}`); return; }
    console.log(`${C.bold}内置角色${C.reset}`);
    for (const [n, r] of Object.entries(BUILTIN_ROLES)) {
        const editable = r.editable ? '' : `${C.gray}（锁定）${C.reset}`;
        console.log(`  ${C.cyan}${padR(n, 20)}${C.reset}${r.display} ${editable}`);
    }
    if (d.roles && Object.keys(d.roles).length) {
        console.log(`${C.bold}自定义角色${C.reset}`);
        for (const [n, r] of Object.entries(d.roles)) {
            console.log(`  ${C.cyan}${padR(n, 20)}${C.reset}${r.display || n}`);
        }
    }
}
function perms(args) {
    const name = args[0];
    if (!name) { console.log(`${C.red}用法：domain perms <name>${C.reset}`); return; }
    const d = storage.loadDomain(name);
    if (!d.name) { console.log(`${C.red}域 ${name} 不存在${C.reset}`); return; }
    const list = [];
    for (const [n, r] of Object.entries(BUILTIN_ROLES)) {
        let perm = r.perm;
        if (r.editable && d.perm_overrides && d.perm_overrides[n] !== undefined) {
            perm = d.perm_overrides[n];
        }
        list.push([n, perm]);
    }
    if (d.roles) {
        for (const [n, r] of Object.entries(d.roles)) list.push([n, r.perm || 0]);
    }
    for (const [n, p] of list) {
        const v = bits.bitOf(p);
        const hi = v.hi.toString(16).padStart(8, '0');
        const lo = v.lo.toString(16).padStart(8, '0');
        console.log(`  ${C.cyan}${padR(n, 20)}${C.reset}0x${hi}${lo}`);
    }
}
module.exports = { roles, perms };

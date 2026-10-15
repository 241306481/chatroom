'use strict';
const bans = require('../../auth/bans');
const { C, padR, fmtIso } = require('../ui');

function usage(sub) {
    console.log(`${C.red}用法：ban ${sub}${C.reset}`);
}

// 列出解封时间非法的封禁记录
function audit(args) {
    const bad = bans.auditInvalidBans();
    const n = bad.users.length + bad.domains.length + bad.mutes.length + bad.ipRules.length;
    if (!n) {
        console.log(`${C.green}✔ 全部封禁与禁言记录的解禁时间都合法${C.reset}`);
        return;
    }
    console.log(`${C.yellow}⚠ 发现 ${n} 条解禁时间非法的记录${C.reset}`);
    console.log(`${C.gray}  这些值无法被正确解释，运行时会按「永久」处理${C.reset}\n`);

    const show = (title, rows, key) => {
        if (!rows.length) return;
        console.log(`${C.bold}${title}${C.reset}`);
        console.log(`${C.gray}${'─'.repeat(64)}${C.reset}`);
        for (const b of rows) {
            const bad2 = `${C.red}${b.until === '' ? '(空)' : b.until}${C.reset}`;
            if (key) console.log(padR(b.domain, 24) + padR(b.uid, 12) + bad2);
            else console.log(padR(b.rule, 24) + bad2);
        }
    };
    if (bad.users.length) {
        console.log(`${C.bold}全局封禁${C.reset}`);
        console.log(`${C.gray}${'─'.repeat(64)}${C.reset}`);
        for (const b of bad.users) {
            console.log(padR(b.uid, 10) + padR(b.nickname || '—', 22)
                + `${C.red}${b.until === '' ? '(空)' : b.until}${C.reset}`);
        }
    }
    show('域内封禁', bad.domains, true);
    show('域内禁言', bad.mutes, true);
    show('IP 封禁规则', bad.ipRules, false);
    console.log(`${C.gray}\n  执行 ${C.reset}ban repair${C.gray} 可把它们归一为「永久」${C.reset}`);
    void args;
}

// 把非法 until 归一为「永久」，保留封禁本身
function repair(args) {
    const sub = (args[0] || '').toLowerCase();
    if (sub && sub !== 'yes') {
        const bad = bans.auditInvalidBans();
        const n = bad.users.length + bad.domains.length + bad.mutes.length + bad.ipRules.length;
        if (!n) { console.log(`${C.green}✔ 没有需要修复的记录${C.reset}`); return; }
        console.log(`${C.red}将修复 ${n} 条记录，非法解禁时间会变为「永久」${C.reset}`);
        console.log(`${C.gray}  确认请执行：${C.reset}ban repair yes`);
        return;
    }
    const fixed = bans.repairInvalidBans();
    const n = fixed.users + fixed.domains + fixed.mutes + fixed.ipRules;
    if (!n) { console.log(`${C.green}✔ 没有需要修复的记录${C.reset}`); return; }
    console.log(`${C.green}✔ 已修复 ${n} 条${C.reset}  封禁 ${fixed.users}，域内封禁 ${fixed.domains}，`
        + `禁言 ${fixed.mutes}，IP 规则 ${fixed.ipRules}`);
    console.log(`${C.yellow}  这些记录现在是永久的，请在管理页确认是否需要设置解禁时间${C.reset}`);
    console.log(`${C.gray}  ${fmtIso(new Date().toISOString())}${C.reset}`);
}

module.exports = { audit, repair };

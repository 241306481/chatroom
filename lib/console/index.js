'use strict';
const readline = require('readline');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const storage = require('../storage');
const { C } = require('./ui');
const { printHelp, printBanner } = require('./help');
const userCommands = require('./commands/user');
const dmCommands = require('./commands/dm');
const userFileCommands = require('./commands/user-file');
const domainCommands = require('./commands/domain');
const domainUserCommands = require('./commands/domain-user');
const discussCommands = require('./commands/discuss');
const domainFileCommands = require('./commands/domain-file');
const systemCommands = require('./commands/system');
const domainAppCommands = require('./commands/domain-app');
const ipbanCommands = require('./commands/ipban');
const sysRoleCommands = require('./commands/sysrole');
const expCommands = require('./commands/exp');
const msgCommands = require('./commands/msg');
const sessionCommands = require('./commands/session');
const banCommands = require('./commands/ban');
const checkCommands = require('./commands/check');
const auditCommands = require('./commands/audit');
storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();
const SINGLE = {
    config: systemCommands,
    ipban: ipbanCommands,
    sysrole: sysRoleCommands,
    exp: expCommands,
    msg: msgCommands,
    session: sessionCommands,
    ban: banCommands,
    check: checkCommands,
    audit: auditCommands,
};
const NESTED = {
    user: {
        file: userFileCommands,
        dm: dmCommands,
    },
    domain: {
        user: domainUserCommands,
        discuss: discussCommands,
        file: domainFileCommands,
        app: domainAppCommands,
    },
};
let rl = null;
function unknown(parts) {
    const label = parts.filter(Boolean).join(' ');
    console.log(`${C.yellow}未知子命令：${label}${C.reset}`);
}
function dispatch(line) {
    const parts = String(line || '').trim().split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const sub = (parts[1] || '').toLowerCase();
    const args = parts.slice(2);
    if (!cmd) return true;
    if (cmd === 'exit' || cmd === 'quit') return false;
    if (cmd === 'help' || cmd === '?') { printHelp(); return true; }
    if (cmd === 'clear' || cmd === 'cls') { process.stdout.write('\x1b[2J\x1b[H'); return true; }
    if (cmd === 'stats') { systemCommands.stats(); return true; }
    const single = SINGLE[cmd];
    if (single) {
        const fn = single[sub] || single.__default;
        if (fn) fn(args);
        else unknown([cmd, sub]);
        return true;
    }
    const nested = NESTED[cmd];
    if (nested && nested[sub]) {
        const action = (parts[2] || '').toLowerCase();
        const fn = nested[sub][action];
        if (fn) fn(parts.slice(3));
        else unknown([cmd, sub, action]);
        return true;
    }
    if (cmd === 'user' || cmd === 'domain') {
        const mod = cmd === 'user' ? userCommands : domainCommands;
        const fn = mod[sub];
        if (fn) fn(args);
        else unknown([cmd, sub]);
        return true;
    }
    console.log(`${C.yellow}未知命令：${cmd}（输入 help 查看帮助）${C.reset}`);
    return true;
}
function startRepl() {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${C.cyan}chatroom>${C.reset} `,
        terminal: !!process.stdin.isTTY,
    });
    printBanner();
    rl.prompt();
    rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) { rl.prompt(); return; }
        try {
            if (!dispatch(trimmed)) { rl.close(); return; }
        } catch (e) {
            console.log(`${C.red}✘ ${e.message}${C.reset}`);
        }
        rl.prompt();
    });
    rl.on('close', () => {
        console.log(`${C.gray}再见${C.reset}`);
        process.exit(0);
    });
}
function runCli(argv) {
    const args = argv.slice();
    if (args[0] === '--help' || args[0] === '-h') {
        printHelp();
        return 0;
    }
    if (args[0] === '--version' || args[0] === '-v') {
        console.log(require(path.join(ROOT, 'package.json')).version);
        return 0;
    }
    try {
        dispatch(args.join(' '));
        return 0;
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
        return 1;
    }
}
if (require.main === module) {
    if (process.argv.length > 2) {
        process.exitCode = runCli(process.argv.slice(2));
    } else {
        startRepl();
    }
}
module.exports = { dispatch, runCli };

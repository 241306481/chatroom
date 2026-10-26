'use strict';
const readline = require('readline');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);
const storage = require('../storage');
const { C } = require('./ui');
const { printHelp, printBanner } = require('./help');
const userCommands       = require('./commands/user');
const dmCommands         = require('./commands/dm');
const userFileCommands   = require('./commands/user-file');
const domainCommands     = require('./commands/domain');
const domainUserCommands = require('./commands/domain-user');
const discussCommands    = require('./commands/discuss');
const domainFileCommands = require('./commands/domain-file');
const systemCommands     = require('./commands/system');
const domainAppCommands  = require('./commands/domain-app');
const ipbanCommands      = require('./commands/ipban');
const sysRoleCommands    = require('./commands/sysrole');
const expCommands        = require('./commands/exp');
const msgCommands        = require('./commands/msg');
const sessionCommands    = require('./commands/session');
const banCommands        = require('./commands/ban');
const checkCommands      = require('./commands/check');
storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();
function dispatch(line) {
    const parts = line.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const sub = (parts[1] || '').toLowerCase();
    const args = parts.slice(2);
    if (cmd === 'exit' || cmd === 'quit') { rl.close(); return; }
    if (cmd === 'help' || cmd === '?')    { printHelp(); return; }
    if (cmd === 'clear' || cmd === 'cls') { process.stdout.write('\x1b[2J\x1b[H'); return; }
    if (cmd === 'stats')                  { systemCommands.stats(); return; }
    const SINGLE = {
        config:   systemCommands,
        ipban:    ipbanCommands,
        sysrole:  sysRoleCommands,
        exp:      expCommands,
        msg:      msgCommands,
        session:  sessionCommands,
        ban:      banCommands,
        check:    checkCommands,
    };
    if (SINGLE[cmd]) {
        const mod = SINGLE[cmd];
        const fn = mod[sub] || mod.__default;
        if (fn) fn(args);
        else console.log(`${C.yellow}未知子命令：${cmd}${sub ? ' ' + sub : ''}${C.reset}`);
        return;
    }
    if (cmd === 'user' && sub === 'file') {
        const action = (parts[2] || '').toLowerCase();
        const rest = parts.slice(3);
        const fn = userFileCommands[action];
        if (fn) fn(rest);
        else console.log(`${C.yellow}未知子命令：user file ${action}${C.reset}`);
        return;
    }
    if (cmd === 'user' && sub === 'dm') {
        const action = (parts[2] || '').toLowerCase();
        const rest = parts.slice(3);
        const fn = dmCommands[action];
        if (fn) fn(rest);
        else console.log(`${C.yellow}未知子命令：user dm ${action}${C.reset}`);
        return;
    }
    if (cmd === 'domain' && sub === 'user') {
        const action = (parts[2] || '').toLowerCase();
        const rest = parts.slice(3);
        const fn = domainUserCommands[action];
        if (fn) fn(rest);
        else console.log(`${C.yellow}未知子命令：domain user ${action}${C.reset}`);
        return;
    }
    if (cmd === 'domain' && sub === 'discuss') {
        const action = (parts[2] || '').toLowerCase();
        const rest = parts.slice(3);
        const fn = discussCommands[action];
        if (fn) fn(rest);
        else console.log(`${C.yellow}未知子命令：domain discuss ${action}${C.reset}`);
        return;
    }
    if (cmd === 'domain' && sub === 'file') {
        const action = (parts[2] || '').toLowerCase();
        const rest = parts.slice(3);
        const fn = domainFileCommands[action];
        if (fn) fn(rest);
        else console.log(`${C.yellow}未知子命令：domain file ${action}${C.reset}`);
        return;
    }
    if (cmd === 'domain' && sub === 'app') {
        const fn = domainAppCommands[(parts[2] || '').toLowerCase()];
        if (fn) fn(parts.slice(3));
        else console.log(`${C.yellow}未知子命令：domain app ${parts[2] || ''}${C.reset}`);
        return;
    }
if (cmd === 'user') {
    const fn = userCommands[sub];
    if (fn) fn(args);
    else console.log(`${C.yellow}未知子命令：user ${sub}${C.reset}`);
    return;
}
if (cmd === 'domain') {
    const fn = domainCommands[sub];
    if (fn) fn(args);
    else console.log(`${C.yellow}未知子命令：domain ${sub}${C.reset}`);
    return;
}
    console.log(`${C.yellow}未知命令：${cmd}（输入 help 查看帮助）${C.reset}`);
}
const rl = readline.createInterface({
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
        dispatch(trimmed);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
    rl.prompt();
});
rl.on('close', () => {
    console.log(`${C.gray}再见${C.reset}`);
    process.exit(0);
});
module.exports = { dispatch };

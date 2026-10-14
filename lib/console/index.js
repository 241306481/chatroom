'use strict';
const readline = require('readline');
const path = require('path');

// 切换工作目录到项目根
const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);

const storage = require('../storage');
const { C } = require('./ui');
const { printHelp, printBanner } = require('./help');

// 命令处理器
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

// 初始化
storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();

// ============================================================
// 分发
// ============================================================
function dispatch(line) {
    const parts = line.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const sub = (parts[1] || '').toLowerCase();
    const args = parts.slice(2);

    // 顶层命令
    if (cmd === 'exit' || cmd === 'quit') { rl.close(); return; }
    if (cmd === 'help' || cmd === '?')    { printHelp(); return; }
    if (cmd === 'clear' || cmd === 'cls') { process.stdout.write('\x1b[2J\x1b[H'); return; }
    if (cmd === 'stats')                  { systemCommands.stats(); return; }

    // 单层命令：注册表直接映射，避免每加一个功能就往 dispatch 里插一段 if
    const SINGLE = {
        config:   systemCommands,
        ipban:    ipbanCommands,
        sysrole:  sysRoleCommands,
        exp:      expCommands,
        msg:      msgCommands,
        session:  sessionCommands,
    };
    if (SINGLE[cmd]) {
        const mod = SINGLE[cmd];
        // __default：允许省略子命令（config 就是这种情况）
        const fn = mod[sub] || mod.__default;
        if (fn) fn(args);
        else console.log(`${C.yellow}未知子命令：${cmd}${sub ? ' ' + sub : ''}${C.reset}`);
        return;
    }

    // user 多级子命令
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

    // domain 多级子命令
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

// 一级子命令。统一以「位置参数数组」调用处理器，
// 因此所有处理器都必须声明 fn(args) 形参并自行解构。
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

// ============================================================
// REPL
// ============================================================
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
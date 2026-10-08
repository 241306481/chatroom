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

    if (cmd === 'config') {
        if (sub === 'show' || !sub) { systemCommands.configShow(); return; }
        if (sub === 'set')          { systemCommands.configSet(args); return; }
        console.log(`${C.yellow}未知子命令：config ${sub}${C.reset}`);
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
        // domain app approve/reject —— 保留在 discuss 模块或独立处理
        // 这里为保持行为一致，把原 domain app 命令继续走 discuss 里的
        // 简单处理：原代码是独立函数，未拆出，我们内联在这里。
        const action = (parts[2] || '').toLowerCase();
        const rest = parts.slice(3);
        const { domainAppApprove, domainAppReject } = require('./commands/domain-app');
        if (action === 'approve') domainAppApprove(rest);
        else if (action === 'reject') domainAppReject(rest);
        else console.log(`${C.yellow}未知子命令：domain app ${action}${C.reset}`);
        return;
    }

    // 一级子命令
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
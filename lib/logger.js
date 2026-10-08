'use strict';

const C = {
    reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', gray: '\x1b[90m', magenta: '\x1b[35m', bold: '\x1b[1m',
};

function ts() { return new Date().toTimeString().substring(0, 8); }

function http(req, pathname, status, ms) {
    if (pathname.startsWith('/static/') && status < 400) return;
    if (pathname === '/favicon.ico') return;
    if (pathname.startsWith('/.well-known/')) return;
    const color = status >= 500 ? C.red : status >= 400 ? C.yellow : C.green;
    const ip = req._clientIp || '-';
    console.log(`${C.gray}${ts()}${C.reset} ${C.cyan}${ip}${C.reset} ${color}${status}${C.reset} ${req.method} ${pathname} ${C.gray}${ms}ms${C.reset}`);
}

function msg(ip, dn, disc, nickname, content) {
    console.log(`${C.gray}${ts()}${C.reset} ${C.cyan}${ip || '-'}${C.reset} ${C.magenta}[MSG]${C.reset} ${dn}/${disc} <${nickname}> ${content}`);
}

function wsConn(ip, kind, nickname, room) {
    const tag = kind === 'dm' ? '[DM+]' : '[WS+]';
    const label = kind === 'dm' ? nickname : `${nickname} → ${room}`;
    console.log(`${C.gray}${ts()}${C.reset} ${C.cyan}${ip || '-'}${C.reset} ${C.green}${tag}${C.reset} ${label}`);
}

function kick(uid, dn, count) {
    if (count > 0) console.log(`  ${C.yellow}[Kick]${C.reset} ${uid} 从 ${dn} 断开 ${count} 个连接`);
}

function info(msg) { console.log(`${C.gray}[Info]${C.reset} ${msg}`); }
function error(...args) { console.error(`${C.red}[Error]${C.reset}`, ...args); }
function warn(msg) { console.warn(`${C.yellow}[Warn]${C.reset} ${msg}`); }

module.exports = { C, ts, http, msg, wsConn, kick, info, error, warn };
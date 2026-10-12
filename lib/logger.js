'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

// 确保 logs 目录存在
try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
    console.error('[Logger] 无法创建 logs 目录:', e.message);
}

const C = {
    reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', gray: '\x1b[90m', magenta: '\x1b[35m', bold: '\x1b[1m',
};

function ts() { return new Date().toTimeString().substring(0, 8); }

// ---- 文件写入（去 ANSI 颜色）----
let _currentDate = '';
let _writeStream = null;

function getStream() {
    const d = new Date();
    const dateStr = d.getFullYear()
        + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
    if (dateStr !== _currentDate) {
        if (_writeStream) {
            try { _writeStream.end(); } catch (e) {}
        }
        const filePath = path.join(LOG_DIR, dateStr + '.log');
        _writeStream = fs.createWriteStream(filePath, { flags: 'a' });
        _writeStream.on('error', (err) => {
            console.error('[Logger] 日志写入失败:', err.message);
        });
        _currentDate = dateStr;
    }
    return _writeStream;
}

function stripAnsi(s) {
    return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

function toFile(parts) {
    const stream = getStream();
    if (!stream) return;
    const line = stripAnsi(parts.join(' ')) + '\n';
    try { stream.write(line); } catch (e) {}
}

// ---- 通用输出（stdout + 文件）----
function out(parts) {
    console.log(parts.join(' '));
    toFile(parts);
}

function errOut(parts) {
    console.error(parts.join(' '));
    toFile(parts);
}

// ============================================================
// 各类日志
// ============================================================

function http(req, pathname, status, ms) {
    if (pathname.startsWith('/static/') && status < 400) return;
    if (pathname === '/favicon.ico') return;
    if (pathname.startsWith('/.well-known/')) return;
    const color = status >= 500 ? C.red : status >= 400 ? C.yellow : C.green;
    const ip = req._clientIp || '-';
    out([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip}${C.reset}`,
         `${color}${status}${C.reset}`,
         req.method, pathname,
         `${C.gray}${ms}ms${C.reset}`]);
}

function msg(ip, dn, disc, nickname, content) {
    out([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip || '-'}${C.reset}`,
         `${C.magenta}[MSG]${C.reset}`,
         `${dn}/${disc}`,
         `<${nickname}>`,
         content]);
}

function wsConn(ip, kind, nickname, uid, room) {
    const tag = kind === 'dm' ? '[DM+]' : '[WS+]';
    const label = nickname + (uid ? ` (uid: ${uid})` : '')
        + (kind === 'dm' ? '' : (room ? ' → ' + room : ''));
    out([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip || '-'}${C.reset}`,
         `${C.green}${tag}${C.reset}`,
         label]);
}

function wsClose(ip, kind, nickname, uid, room) {
    const tag = kind === 'dm' ? '[DM-]' : '[WS-]';
    const label = nickname + (uid ? ` (uid: ${uid})` : '')
        + (kind === 'dm' ? '' : (room ? ' → ' + room : ''));
    out([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip || '-'}${C.reset}`,
         `${C.yellow}${tag}${C.reset}`,
         label]);
}

function kick(uid, dn, count) {
    if (count > 0) {
        out([`${C.yellow}[Kick]${C.reset}`,
             `${uid} 从 ${dn} 断开 ${count} 个连接`]);
    }
}

function info(message) {
    out([`${C.gray}[Info]${C.reset}`, message]);
}

function error(...args) {
    errOut([`${C.red}[Error]${C.reset}`, ...args]);
}

function warn(message) {
    errOut([`${C.yellow}[Warn]${C.reset}`, message]);
}

module.exports = { C, ts, http, msg, wsConn, wsClose, kick, info, error, warn };
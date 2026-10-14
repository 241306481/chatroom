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

// 日志注入防护。
// 昵称、消息正文、域名等字段是用户可控的，原样拼接时：
//   - 换行/回车可以伪造出任意一条日志（如伪造一条 200 的登录记录）
//   - 裸 ESC 序列可以改写正在 tail 日志的终端（清屏、回车覆盖）
// stripAnsi 只去掉成对的颜色序列，挡不住上面两种情况。
//
// 做法：控制字符一律换成空格（ESC 除外，它是本文件调色板用的），
// 并丢掉所有 ANSI 转义序列 —— 唯独「整段就是一条颜色码」的数组元素
// 予以保留，因为调用方一律把颜色作为独立元素传入。
const CONTROL_RE = /[\x00-\x1a\x1c-\x1f\x7f]/g;
const COLOR_PART_RE = /^\x1b\[[0-9;]*m$/;
const ANSI_SEQ_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

function sanitizeField(s) {
    const raw = String(s == null ? '' : s);
    if (COLOR_PART_RE.test(raw)) return raw;   // 调用方自己的调色板元素
    return raw.replace(CONTROL_RE, ' ').replace(ANSI_SEQ_RE, '').replace(/\x1b/g, '');
}

function toFile(parts) {
    const stream = getStream();
    if (!stream) return;
    const line = stripAnsi(sanitizeField(parts.join(' '))) + '\n';
    try { stream.write(line); } catch (e) {}
}

// ---- 通用输出（stdout + 文件）----
function out(parts) {
    console.log(parts.map(sanitizeField).join(' '));
    toFile(parts);
}

function errOut(parts) {
    console.error(parts.map(sanitizeField).join(' '));
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
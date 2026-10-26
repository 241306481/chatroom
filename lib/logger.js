'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (e) {
    console.error('[Logger] 无法创建 logs 目录:', e.message);
}
const RAW_COLOR = {
    reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', gray: '\x1b[90m', magenta: '\x1b[35m', bold: '\x1b[1m',
};
const { colorEnabled, palette } = require('./color');
const useColor = colorEnabled();
const C = palette(Object.keys(RAW_COLOR), RAW_COLOR, useColor);
const ALLOWED_SEQ = new Set(Object.values(RAW_COLOR).filter(Boolean));
function ts() { return new Date().toTimeString().substring(0, 8); }
let _currentDate = '';
let _writeStream = null;
let _needReopen = false;
let _rotatedToday = 0;
let _bytesWritten = 0;
const MAX_LOG_BYTES = (() => {
    const n = parseInt(process.env.LOG_MAX_BYTES, 10);
    return (Number.isFinite(n) && n > 0) ? n : 32 * 1024 * 1024;
})();
const MAX_LOG_FILES = 5;
function sizeOf(p) {
    try { return fs.statSync(p).size; } catch (e) { return 0; }
}
function nextLogPath(dateStr, isReopen) {
    const slot = i => (i === 0
        ? path.join(LOG_DIR, dateStr + '.log')
        : path.join(LOG_DIR, dateStr + '.' + i + '.log'));
    if (!isReopen) return slot(0);
    _rotatedToday++;
    const maxSlot = MAX_LOG_FILES - 1;
    const idx = ((_rotatedToday - 1) % maxSlot) + 1;
    if (_rotatedToday > maxSlot) {
        const old = slot(idx);
        try { if (fs.existsSync(old)) fs.unlinkSync(old); } catch (e) {}
    }
    return slot(idx);
}
function getStream() {
    const d = new Date();
    const dateStr = d.getFullYear()
        + '-' + String(d.getMonth() + 1).padStart(2, '0')
        + '-' + String(d.getDate()).padStart(2, '0');
    if (dateStr !== _currentDate) _rotatedToday = 0;
    if (_needReopen || dateStr !== _currentDate || !_writeStream) {
        const isReopen = _needReopen === true;
        if (_writeStream) {
            try { _writeStream.end(); } catch (e) {}
            _writeStream = null;
        }
        const filePath = nextLogPath(dateStr, isReopen);
        _writeStream = fs.createWriteStream(filePath, { flags: 'a' });
        _writeStream.on('error', (err) => {
            console.error('[Logger] 日志写入失败:', err.message);
        });
        _currentDate = dateStr;
        _needReopen = false;
        _bytesWritten = (!isReopen && _rotatedToday === 0) ? sizeOf(filePath) : 0;
    }
    return _writeStream;
}
function stripAnsi(s) {
    return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}
const CONTROL_RE = /[\x00-\x1a\x1c-\x1f\x7f]/g;
const COLOR_PART_RE = /^\x1b\[[0-9;]*m$/;
const ANSI_SEQ_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function sanitizeField(s) {
    const raw = String(s == null ? '' : s);
    if (COLOR_PART_RE.test(raw)) return raw;
    return raw.replace(CONTROL_RE, ' ').replace(ANSI_SEQ_RE, '').replace(/\x1b/g, '');
}
function consoleField(s) {
    const raw = String(s == null ? '' : s);
    return raw.replace(ANSI_SEQ_RE, (seq) => (ALLOWED_SEQ.has(seq) ? seq : ''))
        .replace(CONTROL_RE, (ch) => (ch === '\x1b' ? '' : ' '));
}
function toFile(parts) {
    const stream = getStream();
    if (!stream) return;
    const line = stripAnsi(sanitizeField(parts.join(' '))) + '\n';
    try { stream.write(line); } catch (e) {}
    _bytesWritten += Buffer.byteLength(line, 'utf8');
    if (_bytesWritten >= MAX_LOG_BYTES) rotateCurrent();
}
function rotateCurrent() {
    if (_writeStream) {
        try { _writeStream.end(); } catch (e) {}
        _writeStream = null;
    }
    _bytesWritten = 0;
    _needReopen = true;
}
function close() {
    return new Promise((resolve) => {
        if (!_writeStream) { resolve(); return; }
        const s = _writeStream;
        _writeStream = null;
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        try {
            s.end(finish);
        } catch (e) {
            finish();
            return;
        }
        const t = setTimeout(finish, 2000);
        t.unref();
        s.on('error', finish);
    });
}
function out(parts) {
    console.log(parts.map(consoleField).join(' '));
    toFile(parts);
}
function errOut(parts) {
    console.error(parts.map(consoleField).join(' '));
    toFile(parts);
}
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
function msg(ip, dn, disc, nickname, content, uid) {
    const who = uid === undefined || uid === null
        ? `<${nickname}>`
        : `<${nickname} (uid: ${uid})>`;
    out([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip || '-'}${C.reset}`,
         `${C.magenta}[MSG]${C.reset}`,
         `${dn}: #${disc}`,
         who,
         content]);
}
function wsLog(isClose, ip, kind, nickname, uid, room) {
    const isDm = kind === 'dm';
    const tag = isDm ? (isClose ? '[DM-]' : '[DM+]')
        : (isClose ? '[WS-]' : '[WS+]');
    const color = isClose ? C.yellow : C.green;
    const label = nickname + (uid ? ` (uid: ${uid})` : '')
        + (isDm ? '' : (room ? ' → ' + room : ''));
    out([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip || '-'}${C.reset}`,
         `${color}${tag}${C.reset}`,
         label]);
}
function wsConn(ip, kind, nickname, uid, room) {
    wsLog(false, ip, kind, nickname, uid, room);
}
function wsClose(ip, kind, nickname, uid, room) {
    wsLog(true, ip, kind, nickname, uid, room);
}
function kick(uid, dn, count) {
    if (count > 0) {
        out([`${C.yellow}[Kick]${C.reset}`,
             `${uid} 从 ${dn} 断开 ${count} 个连接`]);
    }
}
function info(message) {
    out([`${C.gray}${ts()}${C.reset}`, message]);
}
function error(...args) {
    errOut([`${C.red}[Error]${C.reset}`, ...args]);
}
function warn(message) {
    errOut([`${C.yellow}[Warn]${C.reset}`, message]);
}
module.exports = { C, ts, http, msg, wsConn, wsClose, kick, info, error, warn, close };

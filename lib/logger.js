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
const auditChain = require('./audit-chain');
const useColor = colorEnabled();
const C = palette(Object.keys(RAW_COLOR), RAW_COLOR, useColor);
const ALLOWED_SEQ = new Set(Object.values(RAW_COLOR).filter(Boolean));
const pad2 = n => String(n).padStart(2, '0');
function dateOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function ts() {
    const d = new Date();
    return dateOf(d) + ' ' + pad2(d.getHours()) + ':'
        + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
let _chainSeq = 0;
let _chainPrev = auditChain.GENESIS;
let _chainReady = false;
let _currentDate = '';
let _writeStream = null;
let _currentPath = '';
let _needReopen = false;
let _rotatedToday = 0;
let _bytesWritten = 0;
const _closing = new Set();
const _pendingDelete = new Set();
const MAX_LOG_BYTES = (() => {
    const n = parseInt(process.env.LOG_MAX_BYTES, 10);
    return (Number.isFinite(n) && n > 0) ? n : 32 * 1024 * 1024;
})();
const MAX_LOG_FILES = 5;
function sizeOf(p) {
    try { return fs.statSync(p).size; } catch (e) { return 0; }
}
function slotPath(dateStr, i) {
    return i === 0
        ? path.join(LOG_DIR, dateStr + '.log')
        : path.join(LOG_DIR, dateStr + '.' + i + '.log');
}
function releasePath(filePath) {
    _closing.delete(filePath);
    if (!_pendingDelete.delete(filePath)) return;
    try { fs.rmSync(filePath, { force: true }); } catch (e) {}
}
function removeTrimmable(filePath) {
    const old = filePath;
    if (_closing.has(old)) {
        _pendingDelete.add(old);
        return;
    }
    try { fs.unlinkSync(old); } catch (e) {}
}
function endStream(stream, filePath) {
    if (!stream) return;
    _closing.add(filePath);
    stream.on('close', () => releasePath(filePath));
    try { stream.end(); } catch (e) { releasePath(filePath); }
}
function nextLogPath(dateStr, isReopen) {
    if (!isReopen) return slotPath(dateStr, 0);
    _rotatedToday++;
    const keep = MAX_LOG_FILES - 1;
    if (_rotatedToday > keep) {
        removeTrimmable(slotPath(dateStr, _rotatedToday - keep));
    }
    return slotPath(dateStr, _rotatedToday);
}
function getStream() {
    const dateStr = dateOf(new Date());
    const dayChanged = dateStr !== _currentDate;
    if (dayChanged) _rotatedToday = 0;
    if (_needReopen || dayChanged || !_writeStream) {
        const isReopen = _needReopen && !dayChanged;
        if (_writeStream) {
            endStream(_writeStream, _currentPath);
            _writeStream = null;
        }
        const filePath = nextLogPath(dateStr, isReopen);
        _writeStream = fs.createWriteStream(filePath, { flags: 'a' });
        _writeStream.on('error', (err) => {
            console.error('[Logger] 日志写入失败:', err.message);
        });
        _currentDate = dateStr;
        _currentPath = filePath;
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
const MAX_LOG_BUFFER_BYTES = 8 * 1024 * 1024;
function writeLine(line, done, critical) {
    const stream = getStream();
    if (!stream) {
        if (done) done();
        return;
    }
    if (!critical && stream.writableLength > MAX_LOG_BUFFER_BYTES) {
        if (done) done();
        return;
    }
    const text = line + '\n';
    try { stream.write(text, done); } catch (e) { if (done) done(); }
    _bytesWritten += Buffer.byteLength(text, 'utf8');
    if (_bytesWritten >= MAX_LOG_BYTES) rotateCurrent();
}
function toFile(parts, critical) {
    writeLine(stripAnsi(sanitizeField(parts.join(' '))), null, critical);
}
function initChain() {
    if (_chainReady) return;
    _chainReady = true;
    let latest = null;
    try { latest = require('./audit-log').latestChain(); } catch (e) {}
    const checkpoint = auditChain.loadCheckpoint();
    if (checkpoint && (!latest || checkpoint.seq > latest.seq)) {
        _chainSeq = checkpoint.seq;
        _chainPrev = checkpoint.hash;
    } else if (latest) {
        _chainSeq = latest.seq;
        _chainPrev = latest.hash;
    }
}
function chainedOut(parts) {
    initChain();
    console.log(parts.map(consoleField).join(' '));
    const payload = stripAnsi(sanitizeField(parts.join(' ')));
    const record = auditChain.append(payload, _chainSeq + 1, _chainPrev);
    _chainSeq = record.seq;
    _chainPrev = record.hash;
    writeLine(record.line, () => auditChain.scheduleCheckpoint({
        seq: record.seq, hash: record.hash,
    }), true);
}
function rotateCurrent() {
    if (_writeStream) {
        endStream(_writeStream, _currentPath);
        _writeStream = null;
    }
    _bytesWritten = 0;
    _needReopen = true;
}
function close() {
    return new Promise((resolve) => {
        if (!_writeStream) {
            auditChain.flushCheckpoint();
            resolve();
            return;
        }
        const s = _writeStream;
        _writeStream = null;
        let done = false;
        const finish = () => {
            if (!done) {
                done = true;
                auditChain.flushCheckpoint();
                resolve();
            }
        };
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
        out([`${C.gray}${ts()}${C.reset}`,
             `${C.yellow}[Kick]${C.reset}`,
             `${uid} 从 ${dn} 断开 ${count} 个连接`]);
    }
}
function audit(uid, nickname, ip, method, pathname, status) {
    chainedOut([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip || '-'}${C.reset}`,
         `${C.yellow}[Audit]${C.reset}`,
         `${nickname || '-'} (uid: ${uid || '-'})`,
         method, pathname, status]);
}
function security(action, ip, detail) {
    chainedOut([`${C.gray}${ts()}${C.reset}`,
         `${C.cyan}${ip || '-'}${C.reset}`,
         `${C.red}[Security]${C.reset}`,
         action, detail]);
}
const SECRET_RE = /([?&](?:token|password|passwd|pwd|secret|api[_-]?key|access_token|refresh_token)=)[^&\s]+/gi;
function redact(value) {
    return String(value == null ? '' : value).replace(SECRET_RE, '$1***');
}
function info(message) {
    out([`${C.gray}${ts()}${C.reset}`, message]);
}
function error(...args) {
    errOut([`${C.gray}${ts()}${C.reset}`,
        `${C.red}[Error]${C.reset}`,
        ...args.map(a => (typeof a === 'string' ? redact(a) : a))]);
}
function warn(message) {
    errOut([`${C.gray}${ts()}${C.reset}`,
        `${C.yellow}[Warn]${C.reset}`, redact(message)]);
}
module.exports = {
    C, ts, http, msg, wsConn, wsClose, kick, audit, security, redact,
    info, error, warn, close,
};

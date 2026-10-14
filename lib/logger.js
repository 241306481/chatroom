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
let _currentDate = '';   // 实际正在写入的日期（用于判断跨天）
let _writeStream = null;
let _needReopen = false; // 写满后要求换下一个文件
let _rotatedToday = 0;   // 当天已经切换到第几个带序号的文件
let _bytesWritten = 0;   // 当前文件已写入的字节数（权威值，不能用 statSync）

// 单文件大小上限与保留份数。
// 按天分文件但不限大小时，一个繁忙实例当天的日志就能涨到几 GB、写满磁盘。
// 上限可用 LOG_MAX_BYTES 调整（低磁盘环境可调小，也便于测试）。
const MAX_LOG_BYTES = (() => {
    const n = parseInt(process.env.LOG_MAX_BYTES, 10);
    return (Number.isFinite(n) && n > 0) ? n : 32 * 1024 * 1024;
})();
const MAX_LOG_FILES = 5;

function sizeOf(p) {
    try { return fs.statSync(p).size; } catch (e) { return 0; }
}

// 选出下一个写入目标。
//
// 两个刻意的设计决定：
// 1. 序号在**进程内**单调递增，不用 statSync 反复判断「当前文件满了吗」。
//    WriteStream 有缓冲，刚 end() 完磁盘上的大小往往是旧的，
//    靠 statSync 判定会永远达不到阈值、轮转形同虚设。
// 2. 全程不重命名任何**被打开的**文件。Windows 上 rename 一个仍持有
//    WriteStream 句柄的文件会失败（EBUSY），而流是异步 flush 的。
//    槽位用满时直接删掉最旧的那份（.1.log）并在同一路径续写：
//    磁盘占用依旧有界，实现也没有平台相关的失败点。
function nextLogPath(dateStr, isReopen) {
    const slot = i => (i === 0
        ? path.join(LOG_DIR, dateStr + '.log')
        : path.join(LOG_DIR, dateStr + '.' + i + '.log'));

    // 当天第一次打开 → 用基准文件。
    if (!isReopen) return slot(0);

    // 每次「写满了重开」前进一个槽位。纯计数，全程不 statSync：
    // WriteStream 有缓冲，刚 end() 完磁盘上的大小往往是旧的，
    // 用它判定会回到同一个文件、轮转形同虚设。
    _rotatedToday++;
    const maxSlot = MAX_LOG_FILES - 1;
    const idx = ((_rotatedToday - 1) % maxSlot) + 1;

    if (_rotatedToday > maxSlot) {
        // 槽位用尽，开始循环复用。必须先删掉再新建 —— 否则这个文件会
        // 被无限追加，磁盘上限失效（实测：最后一个槽涨到 33MB / 阈值 8KB）。
        // 复用的槽位距上次使用已有多轮，其写句柄早已释放，不会撞上 EBUSY。
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
    // 只有真正的跨天才重置序号。
    // 曾经用 _currentDate = '' 来强制换文件，结果下一次 getStream 把
    // 它误判成「跨天」并把 _rotatedToday 清零，于是永远又回到当天第一个文件。
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
        // 当天第一次打开时把磁盘上已有的大小计入，这样「上一次运行已写满」
        // 也能正确触发轮转。此刻还没有本进程对该文件的流，statSync 可信。
        _bytesWritten = (!isReopen && _rotatedToday === 0) ? sizeOf(filePath) : 0;
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
    // 必须在每次写入后累计并即时轮转。
    // 只在「日期变化」时轮转是不够的：单个繁忙实例当天的日志就能涨到几 GB，
    // 而当天不会有第二次日期切换，磁盘上限形同虚设。
    _bytesWritten += Buffer.byteLength(line, 'utf8');
    if (_bytesWritten >= MAX_LOG_BYTES) rotateCurrent();
}

// 体积用内存里的 _bytesWritten 判定，不能 statSync：WriteStream 有缓冲，
// 刚 end() 完磁盘上的文件往往还是旧大小，拿 statSync 判会永远达不到阈值。
// 达到上限就关流并让下一次 getStream() 去开一个新序号的文件。
function rotateCurrent() {
    if (_writeStream) {
        try { _writeStream.end(); } catch (e) {}
        _writeStream = null;
    }
    _bytesWritten = 0;
    _needReopen = true;   // 下次 getStream() 去挑下一个槽位
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
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const logger = require('./logger');
const paths = require('./storage/paths');
const MAX_DEFAULT = 10;
const TIME_DEFAULT = 60;
const ARCHIVE_RE = /^data-\d{14}(?:-\d+)?\.tar\.gz$/;
let cfg = null;
let running = null;
function readConfig() {
    const raw = (process.env.CHATROOM_BACKUP_DIR || '').trim();
    if (!raw) return null;
    const dir = path.resolve(raw);
    const data = path.resolve(paths.DATA_DIR);
    if (dir === data) {
        logger.warn('[Backup] 备份目录不能等于数据目录，已忽略');
        return null;
    }
    const max = parseInt(process.env.CHATROOM_BACKUP_MAX || '', 10);
    const minutes = parseFloat(process.env.CHATROOM_BACKUP_TIME || '');
    return {
        dir, data,
        max: Number.isFinite(max) ? Math.max(0, max) : MAX_DEFAULT,
        minutes: Number.isFinite(minutes) ? Math.max(0, minutes) : TIME_DEFAULT,
    };
}
function init() {
    stop();
    cfg = readConfig();
    if (!cfg) return { enabled: false };
    try {
        fs.mkdirSync(cfg.dir, { recursive: true });
    } catch (e) {
        logger.error('[Backup] 备份目录不可用：' + e.message);
        cfg = null;
        return { enabled: false, error: e.message };
    }
    if (cfg.minutes > 0) {
        const ms = Math.max(100, Math.round(cfg.minutes * 60000));
        cfg.timer = setInterval(() => { runNow('定时').catch(() => {}); }, ms);
        cfg.timer.unref();
    }
    const every = cfg.minutes > 0 ? `每 ${cfg.minutes} 分钟` : '仅关机备份';
    logger.info(`[Backup] ${cfg.dir}，${every}，保留 ${cfg.max} 个包`);
    return { enabled: true, dir: cfg.dir, max: cfg.max, minutes: cfg.minutes };
}
function stop() {
    if (cfg && cfg.timer) {
        clearInterval(cfg.timer);
        cfg.timer = null;
    }
}
function runNow(reason) {
    if (!cfg) cfg = readConfig();
    if (!cfg) return Promise.resolve(null);
    if (running) return running;
    running = doBackup(reason || '手动').finally(() => { running = null; });
    return running;
}
async function doBackup(reason) {
    const t0 = Date.now();
    const dir = cfg.dir;
    fs.mkdirSync(dir, { recursive: true });
    cleanupStale(dir);
    const stamp = stampNow();
    const snap = path.join(dir, `.snapshot-${process.pid}-${Date.now()}`);
    const tmp = path.join(dir, `.archive-${process.pid}-${Date.now()}.tmp`);
    let archive = null;
    try {
        copyTree(cfg.data, snap, dir, inside(dir, cfg.data));
        await writeTarGz(snap, tmp);
        archive = uniqueArchive(dir, stamp);
        fs.renameSync(tmp, archive);
        const bytes = fs.statSync(archive).size;
        prune(dir, cfg.max, archive);
        logger.info(`[Backup] ${reason}完成 ${path.basename(archive)} `
            + `(${Math.max(1, Math.round(bytes / 1024))} KB, ${Date.now() - t0}ms)`);
        return {
            archive: fs.existsSync(archive) ? archive : null,
            bytes,
        };
    } catch (e) {
        logger.error(`[Backup] ${reason}失败：${e.message}`);
        throw e;
    } finally {
        remove(tmp);
        removeTree(snap);
    }
}
function copyTree(src, dest, backupDir, skipBackup) {
    fs.mkdirSync(dest, { recursive: true });
    let entries;
    try {
        entries = fs.readdirSync(src, { withFileTypes: true });
    } catch (e) {
        if (e.code === 'ENOENT') return;
        throw e;
    }
    for (const ent of entries) {
        const abs = path.join(src, ent.name);
        if (skipBackup && inside(abs, backupDir)) continue;
        if (ent.name === '.write-probe' || ent.name.endsWith('.tmp')) continue;
        if (ent.isSymbolicLink()) continue;
        const to = path.join(dest, ent.name);
        if (ent.isDirectory()) {
            copyTree(abs, to, backupDir, skipBackup);
        } else if (ent.isFile()) {
            try {
                fs.copyFileSync(abs, to);
            } catch (e) {
                if (e.code === 'ENOENT') continue;
                if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
                    logger.warn(`[Backup] 跳过被占用文件 ${abs} (${e.code})`);
                    continue;
                }
                throw e;
            }
        }
    }
}
function inside(p, dir) {
    return p === dir || p.startsWith(dir + path.sep);
}
function listEntries(root) {
    const out = [{ type: 'dir', rel: '', abs: root, st: fs.statSync(root) }];
    const walk = (dir, rel) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));
        for (const ent of entries) {
            const abs = path.join(dir, ent.name);
            const r = rel ? rel + '/' + ent.name : ent.name;
            if (ent.isDirectory()) {
                out.push({ type: 'dir', rel: r, abs, st: fs.statSync(abs) });
                walk(abs, r);
            } else if (ent.isFile()) {
                out.push({ type: 'file', rel: r, abs, st: fs.statSync(abs) });
            }
        }
    };
    walk(root, '');
    return out;
}
async function* tarData(entries) {
    for (const e of entries) {
        const isDir = e.type === 'dir';
        const name = isDir ? `data/${e.rel}${e.rel ? '/' : ''}` : `data/${e.rel}`;
        const size = isDir ? 0 : e.st.size;
        yield tarHeader(name, size, Math.floor(e.st.mtimeMs / 1000), isDir ? '5' : '0');
        if (isDir) continue;
        let sent = 0;
        for await (const chunk of fs.createReadStream(e.abs)) {
            sent += chunk.length;
            yield chunk;
        }
        if (sent !== size) throw new Error(`备份时文件大小变化：${e.rel}`);
        const pad = (512 - (sent % 512)) % 512;
        if (pad) yield Buffer.alloc(pad);
    }
    yield Buffer.alloc(1024);
}
async function writeTarGz(src, out) {
    await pipeline(
        Readable.from(tarData(listEntries(src))),
        zlib.createGzip(),
        fs.createWriteStream(out, { flags: 'wx' })
    );
}
function tarHeader(name, size, mtime, type) {
    const { base, prefix } = splitName(name);
    const h = Buffer.alloc(512);
    h.write(base, 0, 100, 'utf8');
    h.write(oct(type === '5' ? 0o755 : 0o644, 8), 100, 8, 'ascii');
    h.write(oct(0, 8), 108, 8, 'ascii');
    h.write(oct(0, 8), 116, 8, 'ascii');
    h.write(oct(size, 12), 124, 12, 'ascii');
    h.write(oct(mtime, 12), 136, 12, 'ascii');
    h.fill(0x20, 148, 156);
    h.write(type, 156, 1, 'ascii');
    h.write('ustar\0', 257, 6, 'ascii');
    h.write('00', 263, 2, 'ascii');
    h.write('root', 265, 4, 'ascii');
    h.write('root', 297, 4, 'ascii');
    if (prefix) h.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    h.write(oct(sum, 7), 148, 7, 'ascii');
    h[155] = 0x20;
    return h;
}
function oct(value, len) {
    const s = Math.max(0, Math.floor(value)).toString(8);
    if (s.length > len - 1) throw new Error('数值超出 tar 字段范围');
    return s.padStart(len - 1, '0') + '\0';
}
function splitName(name) {
    if (Buffer.byteLength(name, 'utf8') <= 100) return { base: name, prefix: '' };
    const parts = name.split('/');
    for (let i = parts.length - 1; i > 0; i--) {
        const prefix = parts.slice(0, i).join('/');
        const base = parts.slice(i).join('/');
        if (Buffer.byteLength(prefix, 'utf8') <= 155
            && Buffer.byteLength(base, 'utf8') <= 100) {
            return { base, prefix };
        }
    }
    throw new Error('路径过长，无法写入 tar：' + name);
}
function stampNow() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
        + `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function uniqueArchive(dir, stamp) {
    const base = `data-${stamp}`;
    let p = path.join(dir, base + '.tar.gz');
    if (!fs.existsSync(p)) return p;
    let max = 1;
    const re = new RegExp('^' + base + '(?:-(\\d+))?\\.tar\\.gz$');
    for (const n of fs.readdirSync(dir)) {
        const m = re.exec(n);
        if (m) max = Math.max(max, m[1] ? parseInt(m[1], 10) : 1);
    }
    for (let i = max + 1; ; i++) {
        p = path.join(dir, `${base}-${i}.tar.gz`);
        if (!fs.existsSync(p)) return p;
    }
}
function prune(dir, max, keep) {
    let files;
    try {
        files = fs.readdirSync(dir).filter(n => ARCHIVE_RE.test(n));
    } catch (e) {
        return;
    }
    if (max <= 0) {
        for (const n of files) remove(path.join(dir, n));
        return;
    }
    const keepName = keep ? path.basename(keep) : null;
    const items = files
        .filter(n => n !== keepName)
        .map(n => {
            let mtime = 0;
            try { mtime = fs.statSync(path.join(dir, n)).mtimeMs; } catch (e) {}
            return { n, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime || b.n.localeCompare(a.n));
    const oldLimit = Math.max(0, max - (keepName ? 1 : 0));
    for (const item of items.slice(oldLimit)) remove(path.join(dir, item.n));
}
function cleanupStale(dir) {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const n of names) {
        const p = path.join(dir, n);
        if (!/^\.(snapshot|archive)-/.test(n)) continue;
        try {
            if (fs.statSync(p).mtimeMs < cutoff) removeTree(p);
        } catch (e) {}
    }
}
function remove(p) {
    try { fs.rmSync(p, { force: true }); } catch (e) {}
}
function removeTree(p) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
}
module.exports = { init, stop, runNow };

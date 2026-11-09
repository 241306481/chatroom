'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const LOG_DIR = path.join(__dirname, '..', 'logs');
const CHECKPOINT_FILE = path.join(LOG_DIR, '.audit-chain.json');
const GENESIS = '0'.repeat(64);
const MARK = '|chain:';
const RECORD_RE = /^([\s\S]*)\|chain:(\d+):([a-f0-9]{64}):([a-f0-9]{64})$/;
function digest(seq, prev, payload) {
    return crypto.createHash('sha256')
        .update(String(seq) + '\n' + String(prev) + '\n' + String(payload), 'utf8')
        .digest('hex');
}
function append(payload, seq, prev) {
    const text = String(payload);
    const hash = digest(seq, prev, text);
    return {
        line: text + MARK + seq + ':' + prev + ':' + hash,
        seq, prev, hash,
    };
}
function parse(line) {
    const m = RECORD_RE.exec(String(line == null ? '' : line).replace(/\r$/, ''));
    if (!m) return null;
    const seq = parseInt(m[2], 10);
    if (!Number.isSafeInteger(seq) || seq < 1) return null;
    return { payload: m[1], seq, prev: m[3], hash: m[4] };
}
function verify(records) {
    const list = (Array.isArray(records) ? records : [])
        .slice()
        .sort((a, b) => a.seq - b.seq);
    const errors = [];
    let prev = null;
    for (const rec of list) {
        if (digest(rec.seq, rec.prev, rec.payload) !== rec.hash) {
            errors.push({ code: 'hash', seq: rec.seq });
        }
        if (prev) {
            if (rec.seq !== prev.seq + 1) {
                errors.push({ code: 'gap', seq: rec.seq, expected: prev.seq + 1 });
            }
            if (rec.prev !== prev.hash) {
                errors.push({ code: 'link', seq: rec.seq });
            }
        }
        prev = rec;
    }
    const first = list[0] || null;
    const last = list[list.length - 1] || null;
    return {
        ok: errors.length === 0,
        checked: list.length,
        errors,
        firstSeq: first ? first.seq : 0,
        lastSeq: last ? last.seq : 0,
        head: last ? last.hash : '',
    };
}
function normalizeCheckpoint(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const seq = parseInt(obj.seq, 10);
    const hash = String(obj.hash || '');
    if (!Number.isSafeInteger(seq) || seq < 1 || !/^[a-f0-9]{64}$/.test(hash)) {
        return null;
    }
    return { seq, hash };
}
function loadCheckpoint() {
    try {
        return normalizeCheckpoint(JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')));
    } catch (e) {
        return null;
    }
}
let pending = null;
let timer = null;
function writeCheckpoint(state) {
    const tmp = CHECKPOINT_FILE + '.' + process.pid + '.tmp';
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify({
            version: 1,
            seq: state.seq,
            hash: state.hash,
            updated_at: new Date().toISOString(),
        }), 'utf8');
        fs.renameSync(tmp, CHECKPOINT_FILE);
    } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
    }
}
function scheduleCheckpoint(state) {
    pending = normalizeCheckpoint(state);
    if (!pending || timer) return;
    timer = setTimeout(() => {
        timer = null;
        flushCheckpoint();
    }, 500);
    timer.unref();
}
function flushCheckpoint() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (!pending) return;
    const state = pending;
    pending = null;
    writeCheckpoint(state);
}
module.exports = {
    GENESIS, MARK, CHECKPOINT_FILE,
    digest, append, parse, verify,
    loadCheckpoint, scheduleCheckpoint, flushCheckpoint,
};

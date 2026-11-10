'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const CRLF2 = Buffer.from('\r\n\r\n');
const MAX_HEADER = 8 * 1024;
const MAX_PARTS = 100;
const MAX_FIELD_NAME = 128;
const MAX_FIELD_BYTES = 1024 * 1024;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
function decodeFilename(value) {
    try {
        const raw = Buffer.from(value, 'latin1');
        const decoded = raw.toString('utf8');
        if (!decoded.includes('\uFFFD')) return decoded;
    } catch (e) {}
    return value;
}
function parseHeaders(text) {
    const nameMatch = text.match(/(?:^|;)\s*name="([^"]*)"/i);
    if (!nameMatch || !nameMatch[1] || nameMatch[1].length > MAX_FIELD_NAME) return null;
    const fileMatch = text.match(/(?:^|;)\s*filename="([^"]*)"/i);
    const ctMatch = text.match(/Content-Type:\s*([^\r\n]+)/i);
    return {
        name: nameMatch[1],
        filename: fileMatch ? decodeFilename(fileMatch[1]) : null,
        mime: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
    };
}
function codeError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}
function parseMultipartStream(req, boundary, opts) {
    const options = opts || {};
    boundary = String(boundary || '').replace(/^"|"$/g, '');
    if (!boundary) return Promise.reject(codeError('bad_boundary', 'No boundary'));
    const startMarker = Buffer.from('--' + boundary);
    const marker = Buffer.from('\r\n--' + boundary);
    const maxBytes = Math.max(1, Number(options.maxBytes) || 0);
    const tempRoot = options.tmpdir || os.tmpdir();
    fs.mkdirSync(tempRoot, { recursive: true });
    const tempDir = fs.mkdtempSync(path.join(tempRoot, 'chatroom-upload-'));
    const fields = Object.create(null);
    let pending = Buffer.alloc(0);
    let state = 'start';
    let total = 0;
    let parts = 0;
    let done = false;
    let fd = null;
    let file = null;
    let partName = null;
    let partDiscard = false;
    let partIsFile = false;
    let fieldChunks = [];
    let fieldBytes = 0;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    function cleanup() {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
            fd = null;
        }
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
    function fail(err) {
        if (done) return;
        done = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        req.removeListener('aborted', onAbort);
        cleanup();
        rejectPromise(err);
    }
    function finish() {
        if (done) return;
        done = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        req.removeListener('aborted', onAbort);
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (e) {}
            fd = null;
        }
        resolvePromise({ fields, file, cleanup });
    }
    function closePart() {
        if (partIsFile) {
            if (fd !== null) {
                try { fs.closeSync(fd); } catch (e) {}
                fd = null;
            }
        } else if (!partDiscard && partName) {
            const value = Buffer.concat(fieldChunks).toString('utf8');
            if (!Object.prototype.hasOwnProperty.call(fields, partName)) {
                fields[partName] = value;
            }
        }
        partName = null;
        partDiscard = false;
        partIsFile = false;
        fieldChunks = [];
        fieldBytes = 0;
    }
    function writeBody(chunk) {
        if (partDiscard || !chunk.length) return;
        if (partIsFile) {
            if (fd === null) throw codeError('bad_stream', 'File not open');
            fs.writeSync(fd, chunk);
            file.size += chunk.length;
            return;
        }
        fieldBytes += chunk.length;
        if (fieldBytes > MAX_FIELD_BYTES) throw codeError('too_large', 'Field too large');
        fieldChunks.push(Buffer.from(chunk));
    }
    function openPart(info) {
        parts += 1;
        if (parts > MAX_PARTS) throw codeError('bad_stream', 'Too many parts');
        if (!info || RESERVED.has(info.name)) {
            partDiscard = true;
            return;
        }
        if (info.filename !== null && info.filename !== '') {
            if (file) throw codeError('bad_stream', 'Multiple files');
            const target = path.join(tempDir, 'file');
            fd = fs.openSync(target, 'w');
            file = {
                tempPath: target,
                filename: info.filename,
                mime: info.mime,
                size: 0,
            };
            partIsFile = true;
            partName = info.name;
            return;
        }
        partName = info.name;
        partIsFile = false;
        partDiscard = false;
        fieldChunks = [];
        fieldBytes = 0;
    }
    function process() {
        while (!done) {
            if (state === 'start') {
                const at = pending.indexOf(startMarker);
                if (at < 0) {
                    const keep = startMarker.length + 4;
                    if (pending.length > keep) pending = pending.subarray(pending.length - keep);
                    return;
                }
                let pos = at + startMarker.length;
                if (pending.length < pos + 2) {
                    pending = pending.subarray(at);
                    return;
                }
                if (pending[pos] === 0x2d && pending[pos + 1] === 0x2d) {
                    finish();
                    return;
                }
                if (pending[pos] !== 0x0d || pending[pos + 1] !== 0x0a) {
                    pending = pending.subarray(at + 1);
                    continue;
                }
                pending = pending.subarray(pos + 2);
                state = 'headers';
                continue;
            }
            if (state === 'headers') {
                const at = pending.indexOf(CRLF2);
                if (at < 0) {
                    if (pending.length > MAX_HEADER) fail(codeError('bad_stream', 'Header too large'));
                    return;
                }
                const text = pending.subarray(0, at).toString('latin1');
                pending = pending.subarray(at + 4);
                openPart(parseHeaders(text));
                state = 'body';
                continue;
            }
            if (state === 'body') {
                const at = pending.indexOf(marker);
                if (at < 0) {
                    const keep = marker.length + 4;
                    if (pending.length > keep) {
                        const emit = pending.subarray(0, pending.length - keep);
                        pending = pending.subarray(pending.length - keep);
                        writeBody(emit);
                    }
                    return;
                }
                writeBody(pending.subarray(0, at));
                pending = pending.subarray(at + marker.length);
                if (pending.length < 2) {
                    state = 'boundary';
                    return;
                }
                if (pending[0] === 0x2d && pending[1] === 0x2d) {
                    pending = pending.subarray(2);
                    closePart();
                    finish();
                    return;
                }
                if (pending[0] === 0x0d && pending[1] === 0x0a) {
                    pending = pending.subarray(2);
                    closePart();
                    state = 'headers';
                    continue;
                }
                writeBody(marker);
                continue;
            }
            if (state === 'boundary') {
                if (pending.length < 2) return;
                if (pending[0] === 0x2d && pending[1] === 0x2d) {
                    pending = pending.subarray(2);
                    closePart();
                    finish();
                    return;
                }
                if (pending[0] === 0x0d && pending[1] === 0x0a) {
                    pending = pending.subarray(2);
                    closePart();
                    state = 'headers';
                    continue;
                }
                writeBody(marker);
                state = 'body';
                continue;
            }
        }
    }
    function onData(chunk) {
        if (done) return;
        total += chunk.length;
        if (total > maxBytes) {
            fail(codeError('too_large', 'Request too large'));
            req.resume();
            return;
        }
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        try {
            process();
        } catch (e) {
            fail(e);
        }
    }
    function onEnd() {
        if (done) return;
        fail(codeError('bad_stream', 'Incomplete multipart body'));
    }
    function onError(err) {
        fail(err || codeError('bad_stream', 'Request error'));
    }
    function onAbort() {
        fail(codeError('aborted', 'Request aborted'));
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAbort);
    return promise;
}
module.exports = { parseMultipartStream };

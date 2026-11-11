'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureDir, thumbPathFor } = require('./storage/fs-utils');

const THUMB_MAX = 480;
const pending = new Map();
let sharpLib;

function getSharp() {
    if (sharpLib !== undefined) return sharpLib;
    try { sharpLib = require('sharp'); }
    catch (e) { sharpLib = null; }
    return sharpLib;
}

function thumbMime() {
    return 'image/webp';
}

function supported(mime) {
    const base = String(mime || '').split(';')[0].trim().toLowerCase();
    return base.startsWith('image/') && base !== 'image/svg+xml';
}

async function build(sourcePath, target) {
    const sharp = getSharp();
    if (!sharp) return null;
    ensureDir(path.dirname(target));
    const tmp = target + '.tmp-' + process.pid + '-'
        + crypto.randomBytes(6).toString('hex');
    try {
        await sharp(sourcePath, {
            limitInputPixels: 40 * 1000 * 1000,
            animated: false,
        })
            .rotate()
            .resize(THUMB_MAX, THUMB_MAX, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .webp({ quality: 76, effort: 4 })
            .toFile(tmp);
        const st = fs.statSync(tmp);
        if (!st.size) throw new Error('empty thumbnail');
        try {
            fs.renameSync(tmp, target);
        } catch (e) {
            try { fs.rmSync(target, { force: true }); } catch (e2) {}
            fs.renameSync(tmp, target);
        }
        return { path: target, mime: thumbMime() };
    } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch (e2) {}
        throw e;
    }
}

function ensureThumb(sourcePath, mime) {
    if (!sourcePath || !supported(mime)) return Promise.resolve(null);
    const target = thumbPathFor(sourcePath);
    try {
        const src = fs.statSync(sourcePath);
        const dst = fs.statSync(target);
        if (dst.size > 0 && dst.mtimeMs >= src.mtimeMs) {
            return Promise.resolve({ path: target, mime: thumbMime() });
        }
    } catch (e) {}
    if (pending.has(target)) return pending.get(target);
    const task = build(sourcePath, target)
        .then(result => result)
        .catch(() => null)
        .finally(() => pending.delete(target));
    pending.set(target, task);
    return task;
}

module.exports = { THUMB_MAX, ensureThumb, thumbMime, supported };

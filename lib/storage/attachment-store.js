'use strict';
const fs = require('fs');
const path = require('path');
const {
    ensureDir, readJson, writeJsonAtomic,
    genUuid, nowIso, makeFileMeta, safeFileId, sliceChars,
} = require('./fs-utils');
function loadIndex(indexPath) {
    if (!fs.existsSync(indexPath)) return { files: {} };
    const idx = readJson(indexPath);
    if (!idx || typeof idx !== 'object' || Array.isArray(idx)) {
        throw new Error('附件索引已损坏，已阻止写入以免丢失历史记录');
    }
    if (!idx.files || typeof idx.files !== 'object' || Array.isArray(idx.files)) {
        idx.files = {};
    }
    return idx;
}
function loadIndexSafe(indexPath) {
    try { return loadIndex(indexPath); }
    catch (e) { return { files: {} }; }
}
function saveIndex(indexPath, idx) { writeJsonAtomic(indexPath, idx); }
function cleanName(filename) {
    const name = sliceChars(String(filename || '').trim(), 200)
        .replace(/[\\/:*?"<>|\r\n\t\0\x00-\x1f]/g, '_');
    return name || 'unnamed';
}
function addAttachment(indexPath, filesDir, { filename, mime, buffer, uploader, extra }) {
    const idx = loadIndex(indexPath);
    const name = cleanName(filename);
    const id = genUuid();
    ensureDir(filesDir);
    fs.writeFileSync(path.join(filesDir, id), buffer);
    const meta = makeFileMeta({ id, name, mime, buffer, owner: uploader });
    meta.refs = {};
    if (extra && typeof extra === 'object') Object.assign(meta, extra);
    idx.files[id] = meta;
    saveIndex(indexPath, idx);
    return meta;
}
function getAttachment(indexPath, id) {
    const k = safeFileId(id);
    if (!k) return null;
    const meta = loadIndexSafe(indexPath).files[k];
    return (meta && typeof meta === 'object') ? meta : null;
}
function getAttachmentContent(filesDir, id) {
    const k = safeFileId(id);
    if (!k) return null;
    const p = path.join(filesDir, k);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function listAttachments(indexPath) {
    return Object.values(loadIndexSafe(indexPath).files)
        .filter(m => m && typeof m === 'object')
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}
function totalRefs(meta) {
    if (!meta || !meta.refs || typeof meta.refs !== 'object') return 0;
    let n = 0;
    for (const value of Object.values(meta.refs)) {
        n += Math.max(0, Number(value) || 0);
    }
    return n;
}
function addRef(indexPath, id, scope, delta) {
    const k = safeFileId(id);
    if (!k) return null;
    const idx = loadIndex(indexPath);
    const meta = idx.files[k];
    if (!meta || typeof meta !== 'object') return null;
    if (!meta.refs || typeof meta.refs !== 'object') meta.refs = {};
    const key = String(scope);
    const step = Number(delta) || 1;
    meta.refs[key] = Math.max(0, (Number(meta.refs[key]) || 0) + step);
    if (!meta.refs[key]) delete meta.refs[key];
    saveIndex(indexPath, idx);
    return meta;
}
function deleteAttachment(indexPath, filesDir, id) {
    const k = safeFileId(id);
    if (!k) return false;
    const idx = loadIndex(indexPath);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) return false;
    delete idx.files[k];
    saveIndex(indexPath, idx);
    const p = path.join(filesDir, k);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
}
function releaseRef(indexPath, filesDir, id, scope) {
    const k = safeFileId(id);
    if (!k) return { deleted: false, meta: null };
    const idx = loadIndex(indexPath);
    const meta = idx.files[k];
    if (!meta || typeof meta !== 'object') return { deleted: false, meta: null };
    if (!meta.refs || typeof meta.refs !== 'object') meta.refs = {};
    const key = String(scope);
    const next = Math.max(0, (Number(meta.refs[key]) || 0) - 1);
    if (next === 0) delete meta.refs[key];
    else meta.refs[key] = next;
    if (totalRefs(meta) === 0) {
        delete idx.files[k];
        saveIndex(indexPath, idx);
        const p = path.join(filesDir, k);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return { deleted: true, meta };
    }
    saveIndex(indexPath, idx);
    return { deleted: false, meta };
}
function gcAttachments(indexPath, filesDir, maxAgeMs) {
    const idx = loadIndexSafe(indexPath);
    const now = Date.now();
    let removed = 0;
    for (const [id, meta] of Object.entries(idx.files)) {
        if (!meta || typeof meta !== 'object') continue;
        if (totalRefs(meta) > 0) continue;
        const at = Date.parse(meta.created_at || '');
        if (Number.isFinite(at) && now - at < maxAgeMs) continue;
        delete idx.files[id];
        const p = path.join(filesDir, id);
        if (fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (e) {}
        }
        removed++;
    }
    if (removed) saveIndex(indexPath, idx);
    return removed;
}
module.exports = {
    loadIndex, loadIndexSafe, saveIndex, totalRefs,
    addAttachment, getAttachment, getAttachmentContent, listAttachments,
    addRef, releaseRef, deleteAttachment, gcAttachments,
    nowIso,
};

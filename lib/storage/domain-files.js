'use strict';
const fs = require('fs');
const path = require('path');
const { domainFilesDir, domainFilesIndexPath } = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    makeFileMeta, genFileId, sanitizeFilename, safeFileId,
} = require('./fs-utils');
function loadIndex(dn) {
    const file = domainFilesIndexPath(dn);
    if (!fs.existsSync(file)) return { files: {} };
    const idx = readJson(file);
    if (!idx || typeof idx !== 'object' || Array.isArray(idx)) {
        throw new Error('文件索引已损坏，已阻止写入以免丢失历史记录');
    }
    if (!idx.files || typeof idx.files !== 'object' || Array.isArray(idx.files)) {
        idx.files = {};
    }
    return idx;
}
function saveIndex(dn, idx) { writeJsonAtomic(domainFilesIndexPath(dn), idx); }
function loadIndexSafe(dn) {
    try { return loadIndex(dn); }
    catch (e) { return { files: {} }; }
}
function addDomainFile(dn, { filename, mime, buffer, uploader }) {
    const idx = loadIndex(dn);
    const name = String(filename || 'unnamed').trim() || 'unnamed';
    const id = genFileId();
    ensureDir(domainFilesDir(dn));
    fs.writeFileSync(path.join(domainFilesDir(dn), id), buffer);
    idx.files[id] = makeFileMeta({ id, name, mime, buffer, owner: uploader, domain: dn });
    saveIndex(dn, idx);
    return idx.files[id];
}
function getDomainFile(dn, id) {
    const k = safeFileId(id);
    if (!k) return null;
    const meta = loadIndexSafe(dn).files[k];
    return (meta && typeof meta === 'object') ? meta : null;
}
function getDomainFileContent(dn, id) {
    const k = safeFileId(id);
    if (!k) return null;
    const p = path.join(domainFilesDir(dn), k);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function deleteDomainFile(dn, id) {
    const k = safeFileId(id);
    if (!k) return false;
    const idx = loadIndex(dn);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) return false;
    delete idx.files[k];
    saveIndex(dn, idx);
    const p = path.join(domainFilesDir(dn), k);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
}
function listDomainFiles(dn) {
    return Object.values(loadIndexSafe(dn).files)
        .filter(m => m && typeof m === 'object')
        .sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned))
            || (b.created_at || '').localeCompare(a.created_at || ''));
}
function renameDomainFile(dn, fileId, newFilename) {
    const k = safeFileId(fileId);
    if (!k) throw new Error('文件不存在');
    const idx = loadIndex(dn);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) throw new Error('文件不存在');
    const name = sanitizeFilename(newFilename);
    if (!name) throw new Error('文件名不能为空');
    for (const [id, meta] of Object.entries(idx.files)) {
        if (id !== k && meta.filename === name) throw new Error('已存在同名文件');
    }
    idx.files[k].filename = name;
    saveIndex(dn, idx);
    return idx.files[k];
}
function uniqueFileIds(ids) {
    const out = [];
    for (const raw of Array.isArray(ids) ? ids : []) {
        const id = safeFileId(raw);
        if (id && !out.includes(id)) out.push(id);
    }
    return out;
}
function requireDomainFiles(idx, ids) {
    const keys = uniqueFileIds(ids);
    if (!keys.length) throw new Error('没有选择文件');
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(idx.files, key)) {
            throw new Error('文件不存在');
        }
    }
    return keys;
}
function setDomainFilesPinned(dn, ids, pinned) {
    const idx = loadIndex(dn);
    const keys = requireDomainFiles(idx, ids);
    for (const key of keys) idx.files[key].pinned = !!pinned;
    saveIndex(dn, idx);
    return keys.length;
}
function renameDomainFiles(dn, updates) {
    const idx = loadIndex(dn);
    const list = Array.isArray(updates) ? updates : [];
    if (!list.length) throw new Error('没有选择文件');
    const selected = new Set();
    const targets = [];
    for (const update of list) {
        const id = safeFileId(update && update.id);
        if (!id || selected.has(id)) throw new Error('文件选择无效');
        if (!Object.prototype.hasOwnProperty.call(idx.files, id)) throw new Error('文件不存在');
        const name = sanitizeFilename(update.filename);
        if (!name) throw new Error('文件名不能为空');
        selected.add(id);
        targets.push({ id, name });
    }
    const otherNames = new Set();
    for (const [id, meta] of Object.entries(idx.files)) {
        if (!selected.has(id)) otherNames.add(meta.filename);
    }
    const seen = new Set();
    for (const t of targets) {
        if (otherNames.has(t.name) || seen.has(t.name)) throw new Error('已存在同名文件');
        seen.add(t.name);
    }
    for (const t of targets) idx.files[t.id].filename = t.name;
    saveIndex(dn, idx);
    return targets.length;
}
module.exports = {
    addDomainFile, getDomainFile, getDomainFileContent,
    deleteDomainFile, listDomainFiles, renameDomainFile, renameDomainFiles,
    setDomainFilesPinned,
};

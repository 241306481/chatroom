'use strict';
const fs = require('fs');
const path = require('path');
const { userFilesDir, userFilesIndexPath } = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    makeFileMeta, genFileId, sanitizeFilename, safeFileId,
} = require('./fs-utils');
function loadIndex(uid) {
    const file = userFilesIndexPath(uid);
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
function saveIndex(uid, idx) { writeJsonAtomic(userFilesIndexPath(uid), idx); }
function loadIndexSafe(uid) {
    try { return loadIndex(uid); }
    catch (e) { return { files: {} }; }
}
function addUserFile(uid, { filename, mime, buffer, visibility }) {
    const idx = loadIndex(uid);
    const name = String(filename || 'unnamed').trim() || 'unnamed';
    const id = genFileId();
    ensureDir(userFilesDir(uid));
    fs.writeFileSync(path.join(userFilesDir(uid), id), buffer);
    const meta = makeFileMeta({ id, name, mime, buffer, owner: uid });
    if (visibility === 'public') meta.visibility = 'public';
    idx.files[id] = meta;
    saveIndex(uid, idx);
    return idx.files[id];
}
function getUserFile(uid, id) {
    const k = safeFileId(id);
    if (!k) return null;
    const meta = loadIndexSafe(uid).files[k];
    return (meta && typeof meta === 'object') ? meta : null;
}
function getUserFileContent(uid, id) {
    const k = safeFileId(id);
    if (!k) return null;
    const p = path.join(userFilesDir(uid), k);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function deleteUserFile(uid, id) {
    const k = safeFileId(id);
    if (!k) return false;
    const idx = loadIndex(uid);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) return false;
    delete idx.files[k];
    saveIndex(uid, idx);
    const p = path.join(userFilesDir(uid), k);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
}
function listUserFiles(uid) {
    return Object.values(loadIndexSafe(uid).files)
        .filter(m => m && typeof m === 'object')
        .sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned))
            || (b.created_at || '').localeCompare(a.created_at || ''));
}
function renameUserFile(uid, fileId, newFilename) {
    const k = safeFileId(fileId);
    if (!k) throw new Error('文件不存在');
    const idx = loadIndex(uid);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) throw new Error('文件不存在');
    const name = sanitizeFilename(newFilename);
    if (!name) throw new Error('文件名不能为空');
    for (const [id, meta] of Object.entries(idx.files)) {
        if (id !== k && meta.filename === name) throw new Error('已存在同名文件');
    }
    idx.files[k].filename = name;
    saveIndex(uid, idx);
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
function requireUserFiles(idx, ids) {
    const keys = uniqueFileIds(ids);
    if (!keys.length) throw new Error('没有选择文件');
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(idx.files, key)) {
            throw new Error('文件不存在');
        }
    }
    return keys;
}
function setUserFilesPinned(uid, ids, pinned) {
    const idx = loadIndex(uid);
    const keys = requireUserFiles(idx, ids);
    for (const key of keys) idx.files[key].pinned = !!pinned;
    saveIndex(uid, idx);
    return keys.length;
}
function setUserFilesVisibility(uid, ids, visibility) {
    const idx = loadIndex(uid);
    const keys = requireUserFiles(idx, ids);
    const v = visibility === 'public' ? 'public' : 'private';
    for (const key of keys) idx.files[key].visibility = v;
    saveIndex(uid, idx);
    return keys.length;
}
function renameUserFiles(uid, updates) {
    const idx = loadIndex(uid);
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
    saveIndex(uid, idx);
    return targets.length;
}
function setUserFileVisibility(uid, fileId, visibility) {
    const k = safeFileId(fileId);
    if (!k) throw new Error('文件不存在');
    const idx = loadIndex(uid);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) throw new Error('文件不存在');
    const meta = idx.files[k];
    meta.visibility = visibility === 'public' ? 'public' : 'private';
    saveIndex(uid, idx);
    return meta;
}
module.exports = {
    addUserFile, getUserFile, getUserFileContent,
    deleteUserFile, listUserFiles, renameUserFile, renameUserFiles,
    setUserFileVisibility, setUserFilesPinned, setUserFilesVisibility,
};

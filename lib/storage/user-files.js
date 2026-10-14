'use strict';
const fs = require('fs');
const path = require('path');
const { userFilesDir, userFilesIndexPath } = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    makeFileMeta, genFileId, sliceChars, safeFileId,
} = require('./fs-utils');

// readJson 对「文件不存在」和「文件损坏」都返回 null。
// 损坏时不能退化成 { files: {} } —— 下一次 addUserFile 会用一条新记录
// 覆盖写掉整个索引，所有历史文件的元数据（名称、上传者、可见性）全部丢失，
// 而磁盘上的内容变成无主孤儿文件。参见 messages.js / dm.js 的同类处理。
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

// 只读路径不能因为索引损坏就把整份清单变成空
function loadIndexSafe(uid) {
    try { return loadIndex(uid); }
    catch (e) { return { files: {} }; }
}

function addUserFile(uid, { filename, mime, buffer, visibility }) {
    const idx = loadIndex(uid);
    const name = String(filename || 'unnamed').trim() || 'unnamed';
    // 一律新建 ID：重复上传不应静默覆盖已有文件
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
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function renameUserFile(uid, fileId, newFilename) {
    const k = safeFileId(fileId);
    if (!k) throw new Error('文件不存在');
    const idx = loadIndex(uid);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) throw new Error('文件不存在');
    const name = sliceChars(String(newFilename || '').trim(), 200)
        .replace(/[\\/:*?"<>|\r\n\t\0\x00-\x1f]/g, '_');
    if (!name) throw new Error('文件名不能为空');
    for (const [id, meta] of Object.entries(idx.files)) {
        if (id !== k && meta.filename === name) throw new Error('已存在同名文件');
    }
    idx.files[k].filename = name;
    saveIndex(uid, idx);
    return idx.files[k];
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
    deleteUserFile, listUserFiles, renameUserFile,
    setUserFileVisibility,
};
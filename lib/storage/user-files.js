'use strict';
const fs = require('fs');
const path = require('path');
const { userFilesDir, userFilesIndexPath } = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    makeFileMeta, genFileId, sliceChars,
} = require('./fs-utils');

function loadIndex(uid) { return readJson(userFilesIndexPath(uid)) || { files: {} }; }
function saveIndex(uid, idx) { writeJsonAtomic(userFilesIndexPath(uid), idx); }

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

// 文件 ID 只允许安全字符：既挡路径分隔符，也挡 '..'、'.' 这类目录名
const UNSAFE_ID_RE = /[/\\]|(^|[\\/])\.\.($|[\\/])|^\.\.?$/;
function safeFileId(id) {
    if (!id || typeof id !== 'string') return null;
    if (id === '.' || id === '..') return null;
    if (UNSAFE_ID_RE.test(id)) return null;
    if (id.includes('\0')) return null;
    return id;
}

function getUserFile(uid, id) {
    const k = safeFileId(id);
    if (!k) return null;
    return loadIndex(uid).files[k] || null;
}

function getUserFileContent(uid, id) {
    const k = safeFileId(id);
    if (!k) return null;
    const p = path.join(userFilesDir(uid), k);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

function deleteUserFile(uid, id) {
    const idx = loadIndex(uid);
    if (!idx.files[id]) return false;
    delete idx.files[id];
    saveIndex(uid, idx);
    const p = path.join(userFilesDir(uid), id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
}

function listUserFiles(uid) {
    return Object.values(loadIndex(uid).files)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function renameUserFile(uid, fileId, newFilename) {
    const idx = loadIndex(uid);
    if (!idx.files[fileId]) throw new Error('文件不存在');
    const name = sliceChars(String(newFilename || '').trim(), 200)
        .replace(/[\\/:*?"<>|\r\n\t\0\x00-\x1f]/g, '_');
    if (!name) throw new Error('文件名不能为空');
    for (const [id, meta] of Object.entries(idx.files)) {
        if (id !== fileId && meta.filename === name) throw new Error('已存在同名文件');
    }
    idx.files[fileId].filename = name;
    saveIndex(uid, idx);
    return idx.files[fileId];
}

function setUserFileVisibility(uid, fileId, visibility) {
    const idx = loadIndex(uid);
    const meta = idx.files[fileId];
    if (!meta) throw new Error('文件不存在');
    meta.visibility = visibility === 'public' ? 'public' : 'private';
    saveIndex(uid, idx);
    return meta;
}

module.exports = {
    addUserFile, getUserFile, getUserFileContent,
    deleteUserFile, listUserFiles, renameUserFile,
    setUserFileVisibility,
};
'use strict';
const fs = require('fs');
const path = require('path');
const { userFilesDir, userFilesIndexPath } = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    makeFileMeta, resolveFileId, sliceChars,
} = require('./fs-utils');

function loadIndex(uid) { return readJson(userFilesIndexPath(uid)) || { files: {} }; }
function saveIndex(uid, idx) { writeJsonAtomic(userFilesIndexPath(uid), idx); }

function addUserFile(uid, { filename, mime, buffer }) {
    const idx = loadIndex(uid);
    const name = String(filename || 'unnamed').trim() || 'unnamed';
    const id = resolveFileId(idx, name);

    ensureDir(userFilesDir(uid));
    fs.writeFileSync(path.join(userFilesDir(uid), id), buffer);

    idx.files[id] = makeFileMeta({ id, name, mime, buffer, owner: uid });
    saveIndex(uid, idx);
    return idx.files[id];
}

function getUserFile(uid, id) {
    if (!id || id.includes('/') || id.includes('\\')) return null;
    return loadIndex(uid).files[id] || null;
}

function getUserFileContent(uid, id) {
    if (!id || id.includes('/') || id.includes('\\')) return null;
    const p = path.join(userFilesDir(uid), id);
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
    const name = sliceChars(String(newFilename || '').trim(), 200);
    if (!name) throw new Error('文件名不能为空');
    for (const [id, meta] of Object.entries(idx.files)) {
        if (id !== fileId && meta.filename === name) throw new Error('已存在同名文件');
    }
    idx.files[fileId].filename = name;
    saveIndex(uid, idx);
    return idx.files[fileId];
}

module.exports = {
    addUserFile, getUserFile, getUserFileContent,
    deleteUserFile, listUserFiles, renameUserFile,
};
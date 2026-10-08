'use strict';
const fs = require('fs');
const path = require('path');
const { domainFilesDir, domainFilesIndexPath } = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    makeFileMeta, resolveFileId, sliceChars,
} = require('./fs-utils');

function loadIndex(dn) { return readJson(domainFilesIndexPath(dn)) || { files: {} }; }
function saveIndex(dn, idx) { writeJsonAtomic(domainFilesIndexPath(dn), idx); }

function addDomainFile(dn, { filename, mime, buffer, uploader }) {
    const idx = loadIndex(dn);
    const name = String(filename || 'unnamed').trim() || 'unnamed';
    const id = resolveFileId(idx, name);

    ensureDir(domainFilesDir(dn));
    fs.writeFileSync(path.join(domainFilesDir(dn), id), buffer);

    idx.files[id] = makeFileMeta({ id, name, mime, buffer, owner: uploader, domain: dn });
    saveIndex(dn, idx);
    return idx.files[id];
}

function getDomainFile(dn, id) {
    if (!id || id.includes('/') || id.includes('\\')) return null;
    return loadIndex(dn).files[id] || null;
}

function getDomainFileContent(dn, id) {
    if (!id || id.includes('/') || id.includes('\\')) return null;
    const p = path.join(domainFilesDir(dn), id);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

function deleteDomainFile(dn, id) {
    const idx = loadIndex(dn);
    if (!idx.files[id]) return false;
    delete idx.files[id];
    saveIndex(dn, idx);
    const p = path.join(domainFilesDir(dn), id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
}

function listDomainFiles(dn) {
    return Object.values(loadIndex(dn).files)
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function renameDomainFile(dn, fileId, newFilename) {
    const idx = loadIndex(dn);
    if (!idx.files[fileId]) throw new Error('文件不存在');
    const name = sliceChars(String(newFilename || '').trim(), 200);
    if (!name) throw new Error('文件名不能为空');
    for (const [id, meta] of Object.entries(idx.files)) {
        if (id !== fileId && meta.filename === name) throw new Error('已存在同名文件');
    }
    idx.files[fileId].filename = name;
    saveIndex(dn, idx);
    return idx.files[fileId];
}

module.exports = {
    addDomainFile, getDomainFile, getDomainFileContent,
    deleteDomainFile, listDomainFiles, renameDomainFile,
};
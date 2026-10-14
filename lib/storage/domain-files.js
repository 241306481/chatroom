'use strict';
const fs = require('fs');
const path = require('path');
const { domainFilesDir, domainFilesIndexPath } = require('./paths');
const {
    ensureDir, readJson, writeJsonAtomic,
    makeFileMeta, genFileId, sliceChars, safeFileId,
} = require('./fs-utils');

// 索引损坏时不能退化成空清单：下一次 addDomainFile 会用一条新记录覆盖写掉
// 整个索引，域内所有历史文件的元数据全部丢失，磁盘内容变成无主孤儿文件。
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

// 只读路径不能因为索引损坏就把整份清单变成空
function loadIndexSafe(dn) {
    try { return loadIndex(dn); }
    catch (e) { return { files: {} }; }
}

function addDomainFile(dn, { filename, mime, buffer, uploader }) {
    const idx = loadIndex(dn);
    const name = String(filename || 'unnamed').trim() || 'unnamed';
    // 一律新建 ID：同名文件必须共存，不能覆盖别人的文件
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
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function renameDomainFile(dn, fileId, newFilename) {
    const k = safeFileId(fileId);
    if (!k) throw new Error('文件不存在');
    const idx = loadIndex(dn);
    if (!Object.prototype.hasOwnProperty.call(idx.files, k)) throw new Error('文件不存在');
    const name = sliceChars(String(newFilename || '').trim(), 200)
        .replace(/[\\/:*?"<>|\r\n\t\0\x00-\x1f]/g, '_');
    if (!name) throw new Error('文件名不能为空');
    for (const [id, meta] of Object.entries(idx.files)) {
        if (id !== k && meta.filename === name) throw new Error('已存在同名文件');
    }
    idx.files[k].filename = name;
    saveIndex(dn, idx);
    return idx.files[k];
}

module.exports = {
    addDomainFile, getDomainFile, getDomainFileContent,
    deleteDomainFile, listDomainFiles, renameDomainFile,
};
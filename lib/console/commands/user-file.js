'use strict';
const storage = require('../../storage');
const { C, padR, fmtIso, formatSize, shortId, resolveFileId, resolveUser } = require('../ui');

function list(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user file list <uid>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}用户 ${uid} 不存在${C.reset}`); return; }
    const files = storage.listUserFiles(uid);
    if (!files.length) { console.log(`${C.gray}（无文件）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('ID', 10) + padR('文件名', 32)
        + padR('大小', 10) + '上传时间' + C.reset);
    console.log(`${C.gray}${'─'.repeat(78)}${C.reset}`);
    for (const f of files) {
        console.log(
            padR(shortId(f.id, 8), 10) +
            padR(storage.sliceChars(f.filename, 30), 32) +
            padR(formatSize(f.size), 10) +
            fmtIso(f.created_at)
        );
    }
    console.log(`${C.gray}共 ${files.length} 个文件${C.reset}`);
}

function show(args) {
    const [uid, fid] = args;
    if (!uid || !fid) { console.log(`${C.red}用法：user file show <uid> <fileId>${C.reset}`); return; }
    const files = storage.listUserFiles(uid);
    const rid = resolveFileId(fid, files);
    if (rid && typeof rid === 'object') { console.log(`${C.red}✘ ${rid.error}${C.reset}`); return; }
    const f = storage.getUserFile(uid, rid);
    if (!f) { console.log(`${C.red}文件不存在${C.reset}`); return; }
    console.log(`${C.bold}文件详情${C.reset}`);
    console.log(`  完整 ID：  ${f.id}`);
    console.log(`  文件名：   ${f.filename}`);
    console.log(`  MIME：     ${f.mime || '—'}`);
    console.log(`  大小：     ${formatSize(f.size)}`);
    console.log(`  ETag：     ${f.etag}`);
    console.log(`  上传者：   ${f.uploader}`);
    console.log(`  上传时间： ${fmtIso(f.created_at)}`);
}

function del(args) {
    const [uid, fid] = args;
    if (!uid || !fid) { console.log(`${C.red}用法：user file delete <uid> <fileId>${C.reset}`); return; }
    const files = storage.listUserFiles(uid);
    const rid = resolveFileId(fid, files);
    if (rid && typeof rid === 'object') { console.log(`${C.red}✘ ${rid.error}${C.reset}`); return; }
    const f = storage.getUserFile(uid, rid);
    if (!f) { console.log(`${C.red}文件不存在${C.reset}`); return; }
    if (storage.deleteUserFile(uid, rid)) {
        console.log(`${C.green}✔ 已删除 ${f.filename}${C.reset}`);
    } else {
        console.log(`${C.red}✘ 删除失败${C.reset}`);
    }
}

function rename(args) {
    const [uid, fid, ...rest] = args;
    const newName = rest.join(' ');
    if (!uid || !fid || !newName) {
        console.log(`${C.red}用法：user file rename <uid> <fileId> <newName>${C.reset}`); return;
    }
    const files = storage.listUserFiles(uid);
    const rid = resolveFileId(fid, files);
    if (rid && typeof rid === 'object') { console.log(`${C.red}✘ ${rid.error}${C.reset}`); return; }
    try {
        const meta = storage.renameUserFile(uid, rid, newName);
        console.log(`${C.green}✔ 已重命名为 ${meta.filename}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

module.exports = { list, show, delete: del, rename };
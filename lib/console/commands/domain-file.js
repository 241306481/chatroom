'use strict';
const storage = require('../../storage');
const { C, padR, fmtIso, formatSize, shortId, resolveFileId } = require('../ui');

function list(args) {
    const dn = args[0];
    if (!dn) { console.log(`${C.red}用法：domain file list <domain>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    const files = storage.listDomainFiles(dn);
    if (!files.length) { console.log(`${C.gray}（无文件）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('ID', 10) + padR('文件名', 32)
        + padR('大小', 10) + padR('上传者', 16) + '上传时间' + C.reset);
    console.log(`${C.gray}${'─'.repeat(88)}${C.reset}`);
    for (const f of files) {
        const uploader = storage.loadUser(f.uploader);
        console.log(
            padR(shortId(f.id, 8), 10) +
            padR(storage.sliceChars(f.filename, 30), 32) +
            padR(formatSize(f.size), 10) +
            padR(uploader.nickname || f.uploader || '?', 16) +
            fmtIso(f.created_at)
        );
    }
    console.log(`${C.gray}共 ${files.length} 个文件${C.reset}`);
}

function show(args) {
    const [dn, fid] = args;
    if (!dn || !fid) { console.log(`${C.red}用法：domain file show <domain> <fileId>${C.reset}`); return; }
    const files = storage.listDomainFiles(dn);
    const rid = resolveFileId(fid, files);
    if (rid && typeof rid === 'object') { console.log(`${C.red}✘ ${rid.error}${C.reset}`); return; }
    const f = storage.getDomainFile(dn, rid);
    if (!f) { console.log(`${C.red}文件不存在${C.reset}`); return; }
    const uploader = storage.loadUser(f.uploader);
    console.log(`${C.bold}文件详情${C.reset}`);
    console.log(`  完整 ID：  ${f.id}`);
    console.log(`  文件名：   ${f.filename}`);
    console.log(`  MIME：     ${f.mime || '—'}`);
    console.log(`  大小：     ${formatSize(f.size)}`);
    console.log(`  ETag：     ${f.etag}`);
    console.log(`  上传者：   ${uploader.nickname || '?'} (${f.uploader || '—'})`);
    console.log(`  上传时间： ${fmtIso(f.created_at)}`);
    console.log(`  所属域：   ${f.domain || dn}`);
}

function del(args) {
    const [dn, fid] = args;
    if (!dn || !fid) { console.log(`${C.red}用法：domain file delete <domain> <fileId>${C.reset}`); return; }
    const files = storage.listDomainFiles(dn);
    const rid = resolveFileId(fid, files);
    if (rid && typeof rid === 'object') { console.log(`${C.red}✘ ${rid.error}${C.reset}`); return; }
    const f = storage.getDomainFile(dn, rid);
    if (!f) { console.log(`${C.red}文件不存在${C.reset}`); return; }
    if (storage.deleteDomainFile(dn, rid)) {
        console.log(`${C.green}✔ 已删除 ${f.filename}${C.reset}`);
    } else {
        console.log(`${C.red}✘ 删除失败${C.reset}`);
    }
}

function rename(args) {
    const [dn, fid, ...rest] = args;
    const newName = rest.join(' ');
    if (!dn || !fid || !newName) {
        console.log(`${C.red}用法：domain file rename <domain> <fileId> <newName>${C.reset}`); return;
    }
    const files = storage.listDomainFiles(dn);
    const rid = resolveFileId(fid, files);
    if (rid && typeof rid === 'object') { console.log(`${C.red}✘ ${rid.error}${C.reset}`); return; }
    try {
        const meta = storage.renameDomainFile(dn, rid, newName);
        console.log(`${C.green}✔ 已重命名为 ${meta.filename}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

module.exports = { list, show, delete: del, rename };
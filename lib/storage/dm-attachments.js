'use strict';
const store = require('./attachment-store');
const {
    dmFilesDir, dmFilesIndexPath,
} = require('./paths');
const { safeFileId } = require('./fs-utils');
const FILE_URL_RE = /\/messages\/file\/([^/\s?#<>()]+)\/([^/\s?#<>()]+)\/([^/\s?#<>()]+)/g;
function pair(a, b) {
    return [String(a), String(b)].sort();
}
function addDMAttachment(a, b, file) {
    const meta = store.addAttachment(
        dmFilesIndexPath(a, b), dmFilesDir(a, b),
        Object.assign({}, file, { extra: { conversation: pair(a, b) } })
    );
    try {
        store.gcAttachments(
            dmFilesIndexPath(a, b), dmFilesDir(a, b), 24 * 60 * 60 * 1000);
    } catch (e) {}
    return meta;
}
function getDMAttachment(a, b, id) {
    try { return store.getAttachment(dmFilesIndexPath(a, b), id); }
    catch (e) { return null; }
}
function getDMAttachmentPath(a, b, id) {
    try { return store.getAttachmentPath(dmFilesDir(a, b), id); }
    catch (e) { return null; }
}
function getDMAttachmentContent(a, b, id) {
    try { return store.getAttachmentContent(dmFilesDir(a, b), id); }
    catch (e) { return null; }
}
function listDMAttachments(a, b) {
    try { return store.listAttachments(dmFilesIndexPath(a, b)); }
    catch (e) { return []; }
}
function deleteDMAttachment(a, b, id) {
    try { return store.deleteAttachment(dmFilesIndexPath(a, b), dmFilesDir(a, b), id); }
    catch (e) { return false; }
}
function scope(uid) { return 'u:' + String(uid); }
function addDMRef(a, b, id, uid, delta) {
    try { return store.addRef(dmFilesIndexPath(a, b), id, scope(uid), delta); }
    catch (e) { return null; }
}
function releaseDMRef(a, b, id, uid) {
    try { return store.releaseRef(dmFilesIndexPath(a, b), dmFilesDir(a, b), id, scope(uid)); }
    catch (e) { return { deleted: false, meta: null }; }
}
function extractDMIds(content, a, b) {
    const expected = pair(a, b);
    const found = new Set();
    const text = String(content || '');
    let m;
    FILE_URL_RE.lastIndex = 0;
    while ((m = FILE_URL_RE.exec(text))) {
        let u1, u2, id;
        try {
            u1 = decodeURIComponent(m[1]);
            u2 = decodeURIComponent(m[2]);
            id = decodeURIComponent(m[3]);
        } catch (e) { continue; }
        const got = pair(u1, u2);
        if (got[0] !== expected[0] || got[1] !== expected[1]) continue;
        if (!safeFileId(id)) continue;
        found.add(id);
    }
    return Array.from(found);
}
function gcDMUnreferenced(a, b, maxAgeMs) {
    try { return store.gcAttachments(dmFilesIndexPath(a, b), dmFilesDir(a, b), maxAgeMs); }
    catch (e) { return 0; }
}
module.exports = {
    addDMAttachment, getDMAttachment, getDMAttachmentPath, getDMAttachmentContent,
    listDMAttachments, deleteDMAttachment,
    addDMRef, releaseDMRef, extractDMIds, gcDMUnreferenced,
};

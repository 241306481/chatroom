'use strict';
const store = require('./attachment-store');
const {
    discussFilesDir, discussFilesIndexPath,
} = require('./paths');
const { safeFileId } = require('./fs-utils');
const FILE_URL_RE = /\/domain\/([^/\s?#<>()]+)\/discuss\/([^/\s?#<>()]+)\/file\/([^/\s?#<>()]+)/g;
function addDiscussAttachment(dn, disc, file) {
    return store.addAttachment(
        discussFilesIndexPath(dn, disc), discussFilesDir(dn, disc),
        Object.assign({}, file, { extra: { domain: dn, discussion: disc } })
    );
}
function getDiscussAttachment(dn, disc, id) {
    return store.getAttachment(discussFilesIndexPath(dn, disc), id);
}
function getDiscussAttachmentContent(dn, disc, id) {
    return store.getAttachmentContent(discussFilesDir(dn, disc), id);
}
function listDiscussAttachments(dn, disc) {
    return store.listAttachments(discussFilesIndexPath(dn, disc));
}
function deleteDiscussAttachment(dn, disc, id) {
    return store.deleteAttachment(
        discussFilesIndexPath(dn, disc), discussFilesDir(dn, disc), id);
}
function extractDiscussIds(content, dn, disc) {
    const found = new Set();
    const text = String(content || '');
    let m;
    FILE_URL_RE.lastIndex = 0;
    while ((m = FILE_URL_RE.exec(text))) {
        let gotDn, gotDisc, id;
        try {
            gotDn = decodeURIComponent(m[1]);
            gotDisc = decodeURIComponent(m[2]);
            id = decodeURIComponent(m[3]);
        } catch (e) { continue; }
        if (gotDn !== String(dn) || gotDisc !== String(disc)) continue;
        if (!safeFileId(id)) continue;
        found.add(id);
    }
    return Array.from(found);
}
module.exports = {
    addDiscussAttachment, getDiscussAttachment, getDiscussAttachmentContent,
    listDiscussAttachments, deleteDiscussAttachment, extractDiscussIds,
};

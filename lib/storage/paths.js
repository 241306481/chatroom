'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.CHATROOM_DATA_DIR
    ? path.resolve(process.env.CHATROOM_DATA_DIR)
    : path.join(ROOT, 'data');
const USER_DIR = path.join(DATA_DIR, 'users');
const DOMAIN_DIR = path.join(DATA_DIR, 'domains');
const COUNTER_FILE = path.join(DATA_DIR, 'uid_counter.json');
const NICKNAME_INDEX_FILE = path.join(DATA_DIR, 'nickname_index.json');
const SYSTEM_UID = '1';
function assertSafeName(name, label) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 64
        || /[/\\\0]/.test(name)
        || name.includes('..') || name === '.') {
        throw new Error(`非法${label || '名称'}`);
    }
    return name;
}
function userDir(uid) { return path.join(USER_DIR, assertSafeName(String(uid), 'uid')); }
function userConfigPath(uid) { return path.join(userDir(uid), 'config.json'); }
function userFilesDir(uid) { return path.join(userDir(uid), 'files'); }
function userFilesIndexPath(uid) { return path.join(userDir(uid), 'files.json'); }
function userMsgDir(uid) { return path.join(userDir(uid), 'messages'); }
function dmPeerDir(uid, peer) {
    return path.join(userMsgDir(uid), assertSafeName(String(peer), 'peer'));
}
function dmMessagesDir(uid, peer) { return path.join(dmPeerDir(uid, peer), 'messages'); }
function dmAttachmentPairDir(a, b) {
    const u1 = assertSafeName(String(a), 'uid');
    const u2 = assertSafeName(String(b), 'uid');
    const [lower, higher] = [u1, u2].sort();
    return path.join(userMsgDir(lower), higher);
}
function dmFilesDir(a, b) { return path.join(dmAttachmentPairDir(a, b), 'file'); }
function dmFilesIndexPath(a, b) { return path.join(dmAttachmentPairDir(a, b), 'files.json'); }
function followingPath(uid) { return path.join(userDir(uid), 'following.json'); }
function followersPath(uid) { return path.join(userDir(uid), 'followers.json'); }
function blockedPath(uid) { return path.join(userDir(uid), 'blocked.json'); }
function blockedByPath(uid) { return path.join(userDir(uid), 'blocked_by.json'); }
function unreadCountPath(uid) { return path.join(userDir(uid), 'unread.json'); }
function conversationsPath(uid) { return path.join(userDir(uid), 'conversations.json'); }
function domainDir(name) { return path.join(DOMAIN_DIR, assertSafeName(name, '域名')); }
function domainConfigPath(name) { return path.join(domainDir(name), 'config.json'); }
function domainFilesDir(name) { return path.join(domainDir(name), 'files'); }
function domainFilesIndexPath(name) { return path.join(domainDir(name), 'files.json'); }
function domainDiscussDir(name) { return path.join(domainDir(name), 'discuss'); }
function discussDir(dn, disc) {
    assertSafeName(disc, '讨论名');
    return path.join(domainDiscussDir(dn), disc);
}
function discussConfigPath(dn, disc) { return path.join(discussDir(dn, disc), 'config.json'); }
function discussMessagesDir(dn, disc) {
    assertSafeName(disc, '讨论名');
    return path.join(domainDiscussDir(dn), disc, 'messages');
}
function discussFilesDir(dn, disc) { return path.join(discussDir(dn, disc), 'file'); }
function discussFilesIndexPath(dn, disc) { return path.join(discussDir(dn, disc), 'files.json'); }
module.exports = {
    ROOT, DATA_DIR, USER_DIR, DOMAIN_DIR, COUNTER_FILE, SYSTEM_UID,
    NICKNAME_INDEX_FILE,
    assertSafeName,
    userDir, userConfigPath, userFilesDir, userFilesIndexPath, userMsgDir,
    dmPeerDir, dmMessagesDir, dmAttachmentPairDir, dmFilesDir, dmFilesIndexPath,
    followingPath, followersPath, blockedPath, blockedByPath, unreadCountPath,
    conversationsPath,
    domainDir, domainConfigPath, domainFilesDir, domainFilesIndexPath,
    domainDiscussDir, discussDir, discussConfigPath,
    discussMessagesDir, discussFilesDir, discussFilesIndexPath,
};

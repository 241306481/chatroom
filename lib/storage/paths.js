'use strict';
const path = require('path');

// ============================================================
// 常量
// ============================================================
const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const USER_DIR = path.join(DATA_DIR, 'users');
const DOMAIN_DIR = path.join(DATA_DIR, 'domains');
const COUNTER_FILE = path.join(DATA_DIR, 'uid_counter.json');

const SYSTEM_UID = '1';

// ============================================================
// 名称安全校验
// ============================================================
function assertSafeName(name, label) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 64
        || /[/\\\0]/.test(name)
        || name.includes('..') || name === '.') {
        throw new Error(`非法${label || '名称'}`);
    }
    return name;
}

// ============================================================
// 用户路径
// ============================================================
function userDir(uid) { return path.join(USER_DIR, uid); }
function userConfigPath(uid) { return path.join(userDir(uid), 'config.json'); }
function userFilesDir(uid) { return path.join(userDir(uid), 'files'); }
function userFilesIndexPath(uid) { return path.join(userDir(uid), 'files.json'); }
function userMsgDir(uid) { return path.join(userDir(uid), 'messages'); }

function followingPath(uid) { return path.join(userDir(uid), 'following.json'); }
function followersPath(uid) { return path.join(userDir(uid), 'followers.json'); }
function blockedPath(uid) { return path.join(userDir(uid), 'blocked.json'); }
function blockedByPath(uid) { return path.join(userDir(uid), 'blocked_by.json'); }
function unreadCountPath(uid) { return path.join(userDir(uid), 'unread.json'); }

// ============================================================
// 域路径
// ============================================================
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
function discussMessagesPath(dn, disc) { return path.join(discussDir(dn, disc), 'messages.json'); }

module.exports = {
    ROOT, DATA_DIR, USER_DIR, DOMAIN_DIR, COUNTER_FILE, SYSTEM_UID,
    assertSafeName,
    userDir, userConfigPath, userFilesDir, userFilesIndexPath, userMsgDir,
    followingPath, followersPath, blockedPath, blockedByPath, unreadCountPath,
    domainDir, domainConfigPath, domainFilesDir, domainFilesIndexPath,
    domainDiscussDir, discussDir, discussConfigPath, discussMessagesPath,
};
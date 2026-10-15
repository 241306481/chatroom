'use strict';
const {
    SYSTEM_UID,
    followingPath, followersPath, blockedPath, blockedByPath,
} = require('./paths');
const { readUidList, writeUidList } = require('./fs-utils');
const { loadUser } = require('./users');

// 关注
function getFollowing(uid) { return uid ? readUidList(followingPath(uid)) : []; }
function getFollowers(uid) { return uid ? readUidList(followersPath(uid)) : []; }

function isFollowing(fromUid, toUid) {
    if (!fromUid || !toUid) return false;
    return getFollowing(fromUid).includes(toUid);
}

function follow(fromUid, toUid) {
    if (!fromUid || !toUid || fromUid === toUid) return false;
    if (fromUid === SYSTEM_UID) return false;
    const fromUser = loadUser(fromUid);
    const toUser = loadUser(toUid);
    if (!fromUser.id || fromUser.is_system) return false;
    if (!toUser.id || toUser.is_system) return false;

    const following = getFollowing(fromUid);
    if (!following.includes(toUid)) {
        following.push(toUid);
        writeUidList(followingPath(fromUid), following);
    }
    const followers = getFollowers(toUid);
    if (!followers.includes(fromUid)) {
        followers.push(fromUid);
        writeUidList(followersPath(toUid), followers);
    }
    return true;
}

function unfollow(fromUid, toUid) {
    if (!fromUid || !toUid) return false;
    const fromUser = loadUser(fromUid);
    const toUser = loadUser(toUid);
    if (!fromUser.id || !toUser.id) return false;

    const following = getFollowing(fromUid).filter(u => u !== toUid);
    const followers = getFollowers(toUid).filter(u => u !== fromUid);
    writeUidList(followingPath(fromUid), following);
    writeUidList(followersPath(toUid), followers);
    return true;
}

function getFollowCounts(uid) {
    return {
        following: getFollowing(uid).length,
        followers: getFollowers(uid).length,
    };
}

// 黑名单
function getBlocked(uid) { return uid ? readUidList(blockedPath(uid)) : []; }
function getBlockedBy(uid) { return uid ? readUidList(blockedByPath(uid)) : []; }

function isBlocked(byUid, targetUid) {
    if (!byUid || !targetUid) return false;
    return getBlocked(byUid).includes(targetUid);
}

function blockUser(fromUid, toUid) {
    if (!fromUid || !toUid || fromUid === toUid) return false;
    const fromUser = loadUser(fromUid);
    const toUser = loadUser(toUid);
    if (!fromUser.id || fromUser.is_system) return false;
    if (!toUser.id || toUser.is_system) return false;

    const blocked = getBlocked(fromUid);
    if (!blocked.includes(toUid)) {
        blocked.push(toUid);
        writeUidList(blockedPath(fromUid), blocked);
    }
    const blockedBy = getBlockedBy(toUid);
    if (!blockedBy.includes(fromUid)) {
        blockedBy.push(fromUid);
        writeUidList(blockedByPath(toUid), blockedBy);
    }
    return true;
}

function unblockUser(fromUid, toUid) {
    if (!fromUid || !toUid) return false;
    const fromUser = loadUser(fromUid);
    const toUser = loadUser(toUid);
    if (!fromUser.id || !toUser.id) return false;

    writeUidList(blockedPath(fromUid), getBlocked(fromUid).filter(u => u !== toUid));
    writeUidList(blockedByPath(toUid), getBlockedBy(toUid).filter(u => u !== fromUid));
    return true;
}

module.exports = {
    getFollowing, getFollowers, isFollowing, follow, unfollow, getFollowCounts,
    getBlocked, getBlockedBy, isBlocked, blockUser, unblockUser,
};
'use strict';

const paths = require('./paths');
const fsUtils = require('./fs-utils');
const init = require('./init');
const users = require('./users');
const userFiles = require('./user-files');
const domains = require('./domains');
const domainFiles = require('./domain-files');
const discussions = require('./discussions');
const messages = require('./messages');
const social = require('./social');
const dm = require('./dm');
const online = require('./online');
const ipBans = require('./ip-bans');
const userIps = require('./user-ips');

// system-roles 反向依赖本模块（require('./index')），
// 顶层 require 会因循环依赖拿到未完成的 module.exports，故此处延迟加载
function sysRoles() { return require('./system-roles'); }

module.exports = {
    // ==================== 常量 ====================
    ROOT: paths.ROOT,
    DATA_DIR: paths.DATA_DIR,
    USER_DIR: paths.USER_DIR,
    DOMAIN_DIR: paths.DOMAIN_DIR,
    SYSTEM_UID: paths.SYSTEM_UID,

    // ==================== 工具 ====================
    ensureDirs: init.ensureDirs,
    genUuid: fsUtils.genUuid,
    nowIso: fsUtils.nowIso,
    hashPassword: fsUtils.hashPassword,
    verifyPassword: fsUtils.verifyPassword,
    getNextUid: users.getNextUid,
    sliceChars: fsUtils.sliceChars,

    // ==================== 用户 ====================
    loadUser: users.loadUser,
    saveUser: users.saveUser,
    userExists: users.userExists,
    listAllUsers: users.listAllUsers,
    listRealUsers: users.listRealUsers,
    findUserByNickname: users.findUserByNickname,
    getUserPrivs: users.getUserPrivs,
    indexSet: users.indexSet,
    indexRename: users.indexRename,
    indexRemove: users.indexRemove,
    rebuildIndex: users.rebuildIndex,
    ensureSystemUser: users.ensureSystemUser,
    createUser: users.createUser,

    // ==================== 关注 ====================
    getFollowing: social.getFollowing,
    getFollowers: social.getFollowers,
    isFollowing: social.isFollowing,
    follow: social.follow,
    unfollow: social.unfollow,
    getFollowCounts: social.getFollowCounts,

    // ==================== 黑名单 ====================
    getBlocked: social.getBlocked,
    getBlockedBy: social.getBlockedBy,
    isBlocked: social.isBlocked,
    blockUser: social.blockUser,
    unblockUser: social.unblockUser,

    // ==================== 用户文件 ====================
    addUserFile: userFiles.addUserFile,
    getUserFile: userFiles.getUserFile,
    getUserFileContent: userFiles.getUserFileContent,
    deleteUserFile: userFiles.deleteUserFile,
    listUserFiles: userFiles.listUserFiles,
    renameUserFile: userFiles.renameUserFile,
    setUserFileVisibility: userFiles.setUserFileVisibility,

    // ==================== 域 ====================
    loadDomain: domains.loadDomain,
    saveDomain: domains.saveDomain,
    domainExists: domains.domainExists,
    listAllDomains: domains.listAllDomains,
    createDomain: domains.createDomain,
    deleteDomain: domains.deleteDomain,
    ensureSystemDomain: domains.ensureSystemDomain,

    // ==================== 讨论 ====================
    loadDiscussion: discussions.loadDiscussion,
    saveDiscussion: discussions.saveDiscussion,
    listDiscussions: discussions.listDiscussions,
    deleteDiscussion: discussions.deleteDiscussion,
    updateDiscussionTitle: discussions.updateDiscussionTitle,
    renameDiscussion: discussions.renameDiscussion,

    // ==================== 消息 ====================
    loadAllMessages: messages.loadAllMessages,
    loadMessageRange: messages.loadMessageRange,
    saveAllMessages: messages.saveAllMessages,
    appendMessage: messages.appendMessage,
    findMessage: messages.findMessage,
    updateMessage: messages.updateMessage,
    toggleReaction: messages.toggleReaction,

    // ==================== 域文件 ====================
    addDomainFile: domainFiles.addDomainFile,
    getDomainFile: domainFiles.getDomainFile,
    getDomainFileContent: domainFiles.getDomainFileContent,
    deleteDomainFile: domainFiles.deleteDomainFile,
    listDomainFiles: domainFiles.listDomainFiles,
    renameDomainFile: domainFiles.renameDomainFile,

    // ==================== 私信 ====================
    loadDM: dm.loadDM,
    loadAllDM: dm.loadAllDM,
    appendDM: dm.appendDM,
    saveAllDM: dm.saveAllDM,
    markDMRead: dm.markDMRead,
    listConversations: dm.listConversations,
    getTotalUnread: dm.getTotalUnread,
    loadUnreadCount: dm.loadUnreadCount,
    saveUnreadCount: dm.saveUnreadCount,
    canSendDM: dm.canSendDM,

    // ==================== 在线状态 ====================
    setOnline: online.setOnline,
    isOnline: online.isOnline,
    isOnlineAnywhere: online.isOnlineAnywhere,

    // ==================== IP 封禁 ====================
    validateIpRule: ipBans.validateRule,
    matchIpRule: ipBans.matchRule,
    isIpBanned: ipBans.isBanned,
    addIpBan: ipBans.addBan,
    removeIpBanByRule: ipBans.removeByRule,
    listIpBans: ipBans.listAll,
    loadUserIps: userIps.load,
    recordUserIp: userIps.record,

    // ==================== 系统角色 ====================
    loadSystemRoles: () => sysRoles().loadRoles(),
    getRolePrivs: (name) => sysRoles().getRolePrivs(name),
    invalidateSystemRoles: () => sysRoles().invalidateCache(),
    createSystemRole: (name, display) => sysRoles().createRole(name, display),
    deleteSystemRole: (name) => sysRoles().deleteRole(name),
    saveSystemRolePrivs: (name, privs) => sysRoles().saveRolePrivs(name, privs),
    systemRoleExists: (name) => sysRoles().roleExists(name),
};
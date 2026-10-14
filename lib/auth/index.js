'use strict';

const sessions = require('./sessions');
const account = require('./account');
const systemDm = require('./system-dm');
const checks = require('./checks');
const perms = require('./perms');
const members = require('./members');
const bans = require('./bans');
const exp = require('./exp');
const rateLimit = require('./rate-limit');

module.exports = {
    // ==================== 会话 ====================
    createSession: sessions.createSession,
    getSessionUser: sessions.getSessionUser,
    destroySession: sessions.destroySession,
    destroyAllUserSessions: sessions.destroyAllUserSessions,

    // ==================== 账号 ====================
    login: account.login,
    registerUser: account.registerUser,
    changePassword: account.changePassword,

    // ==================== 系统私信 ====================
    sendSystemDM: systemDm.sendSystemDM,

    // ==================== 只读检查 ====================
    isUserBanned: checks.isUserBanned,
    isUserBannedInDomain: checks.isUserBannedInDomain,
    isOwnerOfAnyDomain: checks.isOwnerOfAnyDomain,
    canKickUser: checks.canKickUser,
    canChangeRole: checks.canChangeRole,
    canGrantRole: checks.canGrantRole,
    canMuteUser: checks.canMuteUser,

    // ==================== 域内权限解析 ====================
    resolveRolePerm: perms.resolveRolePerm,
    getDomainUser: perms.getDomainUser,
    canManageDomain: perms.canManageDomain,

    // ==================== 成员管理 ====================
    grantRole: members.grantRole,
    muteUser: members.muteUser,
    unmuteUser: members.unmuteUser,
    kickUser: members.kickUser,
    transferDomain: members.transferDomain,

    // ==================== 封禁 ====================
    normalizeUntil: bans.normalizeUntil,
    banUserGlobally: bans.banUserGlobally,
    unbanUserGlobally: bans.unbanUserGlobally,
    banUserInDomain: bans.banUserInDomain,
    unbanUserInDomain: bans.unbanUserInDomain,
    setSystemRole: bans.setSystemRole,

    // ==================== 登录限流 ====================
    checkLoginAllowed: rateLimit.checkLoginAllowed,
    noteLoginFailure: rateLimit.noteFailure,
    clearLoginFailures: rateLimit.noteSuccess,
    loginRateLimitStats: rateLimit.stats,

    // ==================== 等级 ====================
    expToLevel: exp.expToLevel,
    expForNextLevel: exp.expForNextLevel,
    addExp: exp.addExp,
};
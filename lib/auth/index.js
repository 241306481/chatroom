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
    createSession: sessions.createSession,
    getSessionUser: sessions.getSessionUser,
    destroySession: sessions.destroySession,
    destroyAllUserSessions: sessions.destroyAllUserSessions,
    login: account.login,
    registerUser: account.registerUser,
    findByAccount: account.findByAccount,
    changePassword: account.changePassword,
    sendSystemDM: systemDm.sendSystemDM,
    isUserBanned: checks.isUserBanned,
    isUserBannedInDomain: checks.isUserBannedInDomain,
    isOwnerOfAnyDomain: checks.isOwnerOfAnyDomain,
    canKickUser: checks.canKickUser,
    canChangeRole: checks.canChangeRole,
    canGrantRole: checks.canGrantRole,
    canMuteUser: checks.canMuteUser,
    resolveRolePerm: perms.resolveRolePerm,
    getDomainUser: perms.getDomainUser,
    canManageDomain: perms.canManageDomain,
    grantRole: members.grantRole,
    muteUser: members.muteUser,
    unmuteUser: members.unmuteUser,
    kickUser: members.kickUser,
    transferDomain: members.transferDomain,
    normalizeUntil: bans.normalizeUntil,
    banUserGlobally: bans.banUserGlobally,
    unbanUserGlobally: bans.unbanUserGlobally,
    banUserInDomain: bans.banUserInDomain,
    unbanUserInDomain: bans.unbanUserInDomain,
    setSystemRole: bans.setSystemRole,
    checkLoginAllowed: rateLimit.checkLoginAllowed,
    noteLoginFailure: rateLimit.noteFailure,
    clearLoginFailures: rateLimit.noteSuccess,
    expToLevel: exp.expToLevel,
    expForNextLevel: exp.expForNextLevel,
    addExp: exp.addExp,
};

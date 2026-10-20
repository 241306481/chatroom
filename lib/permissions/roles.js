'use strict';
// index 再导出
const { PERM, bits } = require('./perm');
const { PRIV, PRIV_ALL } = require('./priv');

// 内置角色
const BUILTIN_ROLES = {
  guest: {
    perm: bits.or(PERM.GENERAL.VIEW, PERM.DISCUSS.VIEW),
    editable: true,
    display: '访客',
  },
  default: {
    perm: bits.orMany([
      PERM.GENERAL.VIEW, PERM.DISCUSS.VIEW, PERM.MESSAGE.SEND,
      PERM.MESSAGE.ADD_REACTION, PERM.MESSAGE.EDIT_OWN,
      PERM.MESSAGE.DELETE_OWN, PERM.FILE.VIEW,
      PERM.FILE.UPLOAD, PERM.FILE.DELETE_OWN,
      PERM.DISCUSS.CREATE, PERM.DISCUSS.EDIT_OWN,
      PERM.DISCUSS.DELETE_OWN,
      PERM.MESSAGE.REVOKE_OWN, PERM.MESSAGE.MENTION_MEMBER,
    ]),
    editable: true,
    display: '成员',
  },
  root: {
    perm: PERM.ALL,
    editable: false,
    display: '管理员',
  },
};

// 系统角色
const SYSTEM_ROLES_BUILTIN = {
  root: {
    display: '超级管理员',
    editable: false,
    privs: {
      base:    PRIV_ALL.base,
      system:  PRIV_ALL.system,
      discuss: PRIV_ALL.discuss,
      message: PRIV_ALL.message,
      file:    PRIV_ALL.file,
      member:  PRIV_ALL.member,
      domain:  PRIV_ALL.domain,
    },
  },

admin: {
    display: '系统管理员',
    editable: true,
    privs: {
      base:    PRIV.BASE.USER_PROFILE
             | PRIV.BASE.CREATE_DOMAIN
             | PRIV.BASE.VIEW_ALL_DOMAIN
             | PRIV.BASE.SEND_DM
             | PRIV.BASE.UPLOAD_FILE
             | PRIV.BASE.UPLOAD_AVATAR
             | PRIV.BASE.MENTION_GLOBAL,

      system:  PRIV.SYSTEM.MANAGE_PANEL
             | PRIV.SYSTEM.EDIT_SETTINGS
             | PRIV.SYSTEM.MANAGE_USERS
             | PRIV.SYSTEM.MANAGE_DOMAINS,

      discuss: PRIV.DISCUSS.VIEW
             | PRIV.DISCUSS.CREATE
             | PRIV.DISCUSS.EDIT
             | PRIV.DISCUSS.EDIT_OWN
             | PRIV.DISCUSS.DELETE
             | PRIV.DISCUSS.DELETE_OWN
             | PRIV.DISCUSS.PIN,

      message: PRIV.MESSAGE.SEND
             | PRIV.MESSAGE.ADD_REACTION
             | PRIV.MESSAGE.EDIT_OWN
             | PRIV.MESSAGE.DELETE_OWN
             | PRIV.MESSAGE.DELETE_ANY
             | PRIV.MESSAGE.REVOKE_OWN
             | PRIV.MESSAGE.REVOKE_ANY
             | PRIV.MESSAGE.PIN,

      file:    PRIV.FILE.VIEW
             | PRIV.FILE.UPLOAD
             | PRIV.FILE.DELETE_OWN
             | PRIV.FILE.DELETE_ANY,

      member:  PRIV.MEMBER.MUTE
             | PRIV.MEMBER.KICK
             | PRIV.MEMBER.MANAGE_USER
             | PRIV.MEMBER.MANAGE_ROLE
             | PRIV.MEMBER.MANAGE_PERM,

      domain:  PRIV.DOMAIN.EDIT
             | PRIV.DOMAIN.MANAGE_JOIN
             | PRIV.DOMAIN.TRANSFER
             | PRIV.DOMAIN.DELETE,
    },
  },

  member: {
    display: '普通用户',
    editable: true,
    privs: {
      base:    PRIV.BASE.USER_PROFILE
             | PRIV.BASE.CREATE_DOMAIN
             | PRIV.BASE.SEND_DM
             | PRIV.BASE.UPLOAD_FILE
             | PRIV.BASE.UPLOAD_AVATAR
             | PRIV.BASE.MENTION_GLOBAL,

      system:  0,

      discuss: PRIV.DISCUSS.VIEW
             | PRIV.DISCUSS.CREATE
             | PRIV.DISCUSS.EDIT
             | PRIV.DISCUSS.EDIT_OWN
             | PRIV.DISCUSS.DELETE
             | PRIV.DISCUSS.DELETE_OWN
             | PRIV.DISCUSS.PIN,

      message: PRIV.MESSAGE.SEND
             | PRIV.MESSAGE.ADD_REACTION
             | PRIV.MESSAGE.EDIT_OWN
             | PRIV.MESSAGE.DELETE_OWN
             | PRIV.MESSAGE.DELETE_ANY
             | PRIV.MESSAGE.REVOKE_OWN
             | PRIV.MESSAGE.REVOKE_ANY
             | PRIV.MESSAGE.PIN,

      file:    PRIV.FILE.VIEW
             | PRIV.FILE.UPLOAD
             | PRIV.FILE.DELETE_OWN
             | PRIV.FILE.DELETE_ANY,

      member:  PRIV.MEMBER.MUTE
             | PRIV.MEMBER.KICK
             | PRIV.MEMBER.MANAGE_USER
             | PRIV.MEMBER.MANAGE_ROLE
             | PRIV.MEMBER.MANAGE_PERM,

      domain:  PRIV.DOMAIN.EDIT
             | PRIV.DOMAIN.MANAGE_JOIN
             | PRIV.DOMAIN.TRANSFER
             | PRIV.DOMAIN.DELETE,
    },
  },

  guest: {
    display: '访客',
    editable: true,
    privs: {
      base:    PRIV.BASE.USER_PROFILE,
      system:  0,
      discuss: 0,
      message: 0,
      file:    0,
      member:  0,
      domain:  0,
    },
  },
};

module.exports = {
    BUILTIN_ROLES, SYSTEM_ROLES_BUILTIN,
};

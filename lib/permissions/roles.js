'use strict';
// 本文件是 lib/permissions/ 的组成部分，由 index.js 统一再导出。
const { PERM } = require('./perm');
const { PRIV, PRIV_ALL } = require('./priv');

// ============================================================
// 内置角色
// ============================================================
const BUILTIN_ROLES = {
  guest: {
    perm: PERM.VIEW | PERM.VIEW_DISCUSSION,
    editable: true,
    display: '访客',
  },
  default: {
    perm: PERM.VIEW | PERM.VIEW_DISCUSSION | PERM.SEND_MESSAGE
      | PERM.ADD_REACTION | PERM.EDIT_OWN_MESSAGE
      | PERM.DELETE_OWN_MESSAGE | PERM.VIEW_FILE
      | PERM.UPLOAD_FILE | PERM.DELETE_OWN_FILE
      | PERM.CREATE_DISCUSSION | PERM.EDIT_OWN_DISCUSSION
      | PERM.DELETE_OWN_DISCUSSION
      | PERM.REVOKE_OWN_MESSAGE | PERM.MENTION_MEMBER,
    editable: true,
    display: '成员',
  },
  root: {
    perm: PERM.ALL,
    editable: false,
    display: '管理员',
  },
};

// ============================================================
// 系统角色（全局 PRIV 角色）
// ============================================================
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
    // 显式枚举：语义是「除超管位外全开」，逐位写明便于核对
    privs: {
      base:    PRIV.BASE.USER_PROFILE
             | PRIV.BASE.CREATE_DOMAIN
             | PRIV.BASE.VIEW_ALL_DOMAIN
             | PRIV.BASE.SEND_DM
             | PRIV.BASE.UPLOAD_FILE
             | PRIV.BASE.MENTION_GLOBAL,

      // 系统组：除 MANAGE_ALL（超管）外全开
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
             | PRIV.MEMBER.MANAGE_ROLE,

      domain:  PRIV.DOMAIN.EDIT
             | PRIV.DOMAIN.MANAGE_JOIN
             | PRIV.DOMAIN.TRANSFER
             | PRIV.DOMAIN.DELETE,
    },
  },

  member: {
    display: '普通用户',
    editable: true,
    // 显式枚举，不使用 PRIV_ALL.xxx：
    // PRIV_ALL 是每组 31 位的全开掩码，会把预留位一起打开，
    // 将来给组新增位时 member 会在无人确认的情况下自动获得。
    privs: {
      base:    PRIV.BASE.USER_PROFILE
             | PRIV.BASE.CREATE_DOMAIN
             | PRIV.BASE.SEND_DM
             | PRIV.BASE.UPLOAD_FILE
             | PRIV.BASE.MENTION_GLOBAL,   // 不含 VIEW_ALL_DOMAIN

      system:  0,                          // 系统管理是特权

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
             | PRIV.MEMBER.MANAGE_ROLE,

      // 域设置类操作（编辑域/转让/删除）由 is_privileged 判定，
      // 只给域所有者 / 域管理员 / 超管 / 系统管理员 / MANAGE_DOMAINS
      domain:  0,
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

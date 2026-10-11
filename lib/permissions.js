'use strict';

// ============================================================
// 用户级权限位（PRIV，分组位掩码）
// ============================================================
const PRIV = {
  // ============ 基础（系统级，不双检）============
  BASE: {
    USER_PROFILE:       1 << 0,
    CREATE_DOMAIN:      1 << 1,
    VIEW_ALL_DOMAIN:    1 << 2,
    SEND_DM:            1 << 3,
    UPLOAD_FILE:        1 << 4,
    MENTION_GLOBAL:     1 << 5,
  },

  // ============ 系统（系统级，不双检）============
  SYSTEM: {
    MANAGE_PANEL:       1 << 0,
    EDIT_SETTINGS:      1 << 1,
    MANAGE_USERS:       1 << 2,
    MANAGE_DOMAINS:     1 << 3,
    MANAGE_ALL:         1 << 4,
  },

  // ============ 讨论（域级，双检）============
  DISCUSS: {
    VIEW:               1 << 0,
    CREATE:             1 << 1,
    EDIT:               1 << 2,
    EDIT_OWN:           1 << 3,
    DELETE:             1 << 4,
    DELETE_OWN:         1 << 5,
    PIN:                1 << 6,
  },

  // ============ 消息（域级，双检）============
  MESSAGE: {
    SEND:               1 << 0,
    ADD_REACTION:       1 << 1,
    EDIT_OWN:           1 << 2,
    DELETE_OWN:         1 << 3,
    DELETE_ANY:         1 << 4,
    REVOKE_OWN:         1 << 5,
    REVOKE_ANY:         1 << 6,
    PIN:                1 << 7,
  },

  // ============ 文件（域级，双检）============
  FILE: {
    VIEW:               1 << 0,
    UPLOAD:             1 << 1,
    DELETE_OWN:         1 << 2,
    DELETE_ANY:         1 << 3,
  },

  // ============ 成员（域级，双检）============
  MEMBER: {
    MUTE:               1 << 0,
    KICK:               1 << 1,
    MANAGE_USER:        1 << 2,
    MANAGE_ROLE:        1 << 3,
  },

  // ============ 域设置（域级，双检）============
  DOMAIN: {
    EDIT:               1 << 0,
    MANAGE_JOIN:        1 << 1,
    TRANSFER:           1 << 2,
    DELETE:             1 << 3,
  },
};

// 各组全开掩码
const PRIV_ALL = {
  base:    0x7FFFFFFF,
  system:  0x7FFFFFFF,
  discuss: 0x7FFFFFFF,
  message: 0x7FFFFFFF,
  file:    0x7FFFFFFF,
  member:  0x7FFFFFFF,
  domain:  0x7FFFFFFF,
};

// 返回一份全新的"全权限"privs 对象（避免共享对象被意外修改）
function makePrivAll() {
  return {
    base:    PRIV_ALL.base,
    system:  PRIV_ALL.system,
    discuss: PRIV_ALL.discuss,
    message: PRIV_ALL.message,
    file:    PRIV_ALL.file,
    member:  PRIV_ALL.member,
    domain:  PRIV_ALL.domain,
  };
}

// ============================================================
// 域级权限位（PERM）
// ============================================================
const PERM = {
  VIEW:                    1 << 0,
  VIEW_USER_PRIVATE_INFO:  1 << 1,
  EDIT_DOMAIN:             1 << 2,
  MOD_BADGE:               1 << 3,
  VIEW_DISCUSSION:         1 << 4,
  CREATE_DISCUSSION:       1 << 5,
  PIN_DISCUSSION:          1 << 6,
  EDIT_DISCUSSION:         1 << 7,
  EDIT_OWN_DISCUSSION:     1 << 8,
  DELETE_DISCUSSION:       1 << 9,
  DELETE_OWN_DISCUSSION:   1 << 10,
  SEND_MESSAGE:            1 << 11,
  ADD_REACTION:            1 << 12,
  EDIT_OWN_MESSAGE:        1 << 13,
  DELETE_OWN_MESSAGE:      1 << 14,
  DELETE_ANY_MESSAGE:      1 << 15,
  PIN_MESSAGE:             1 << 16,
  MUTE_MEMBER:             1 << 17,
  KICK_MEMBER:             1 << 18,
  VIEW_FILE:               1 << 19,
  UPLOAD_FILE:             1 << 20,
  DELETE_ANY_FILE:         1 << 21,
  DELETE_OWN_FILE:         1 << 22,
  MANAGE_ROLE:             1 << 23,
  MANAGE_USER:             1 << 24,
  MANAGE_DISCUSSION:       1 << 25,
  REVOKE_OWN_MESSAGE:      1 << 26,
  REVOKE_ANY_MESSAGE:      1 << 27,
  MENTION_MEMBER:          1 << 28,
};
PERM.ALL = (1 << 29) - 1;

// ============================================================
// 权限元信息（权限管理页展示用）
// ============================================================
const PERM_NAMES = [
  { bit: PERM.VIEW,                   name: '查看域',         group: '一般',
    desc: '允许访问域主页、成员列表' },
  { bit: PERM.EDIT_DOMAIN,            name: '编辑域',         group: '一般',
    desc: '允许修改域显示名、公告、加入方式' },
  { bit: PERM.MOD_BADGE,              name: 'MOD 徽章',       group: '一般',
    desc: '在消息和成员列表中显示 MOD 标识' },

  { bit: PERM.VIEW_DISCUSSION,        name: '查看讨论',       group: '讨论',
    desc: '允许查看讨论区内容' },
  { bit: PERM.CREATE_DISCUSSION,      name: '创建讨论',       group: '讨论',
    desc: '允许创建新的讨论' },
  { bit: PERM.PIN_DISCUSSION,         name: '置顶讨论',       group: '讨论',
    desc: '允许置顶/取消置顶讨论' },
  { bit: PERM.EDIT_DISCUSSION,        name: '编辑任意讨论',   group: '讨论',
    desc: '允许修改他人创建的讨论标题' },
  { bit: PERM.EDIT_OWN_DISCUSSION,    name: '编辑自己的讨论', group: '讨论',
    desc: '允许修改自己创建的讨论标题' },
  { bit: PERM.DELETE_DISCUSSION,      name: '删除任意讨论',   group: '讨论',
    desc: '允许删除任何讨论（含他人创建）' },
  { bit: PERM.DELETE_OWN_DISCUSSION,  name: '删除自己的讨论', group: '讨论',
    desc: '允许删除自己创建的讨论' },
  { bit: PERM.MANAGE_DISCUSSION,      name: '管理讨论',       group: '讨论',
    desc: '隐含创建/编辑/删除/置顶讨论的全部权限' },

  { bit: PERM.SEND_MESSAGE,           name: '发送消息',       group: '消息',
    desc: '允许在讨论区发送消息' },
  { bit: PERM.ADD_REACTION,           name: '添加表情',       group: '消息',
    desc: '允许对消息添加/移除表情回应' },
  { bit: PERM.DELETE_OWN_MESSAGE,     name: '删除自己的消息', group: '消息',
    desc: '允许删除自己发送的消息' },
  { bit: PERM.DELETE_ANY_MESSAGE,     name: '删除任意消息',   group: '消息',
    desc: '允许删除他人发送的消息' },
  { bit: PERM.REVOKE_OWN_MESSAGE,     name: '撤回自己的消息', group: '消息',
    desc: '允许撤回自己发送的消息（保留占位）' },
  { bit: PERM.REVOKE_ANY_MESSAGE,     name: '撤回任意消息',   group: '消息',
    desc: '允许撤回他人发送的消息' },
  { bit: PERM.PIN_MESSAGE,            name: '置顶消息',       group: '消息',
    desc: '允许置顶/取消置顶消息' },
  { bit: PERM.MENTION_MEMBER,         name: '提及成员',       group: '消息',
    desc: '允许 @ 本域成员（需同时拥有全局「全局提及」权限）' },
  { bit: PERM.MUTE_MEMBER,            name: '禁言成员',       group: '消息',
    desc: '允许在域内禁言/解禁成员' },
  { bit: PERM.KICK_MEMBER,            name: '踢出成员',       group: '消息',
    desc: '允许从域内踢出、封禁成员' },

  { bit: PERM.VIEW_FILE,              name: '查看文件',       group: '文件',
    desc: '允许查看和下载域内文件' },
  { bit: PERM.UPLOAD_FILE,            name: '上传文件',       group: '文件',
    desc: '允许上传文件到域内' },
  { bit: PERM.DELETE_ANY_FILE,        name: '删除任意文件',   group: '文件',
    desc: '允许删除他人上传的文件' },
  { bit: PERM.DELETE_OWN_FILE,        name: '删除自己的文件', group: '文件',
    desc: '允许删除自己上传的文件' },

  { bit: PERM.MANAGE_ROLE,            name: '管理角色',       group: '管理',
    desc: '允许创建、删除域角色并配置权限' },
  { bit: PERM.MANAGE_USER,            name: '管理用户',       group: '管理',
    desc: '允许分配角色、禁言、踢出域成员（隐含禁言+踢出）' },
];

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
    privs: {
      base:    PRIV_ALL.base,
      system:  PRIV_ALL.system & ~PRIV.SYSTEM.MANAGE_ALL,  // 除超管位
      discuss: PRIV_ALL.discuss,
      message: PRIV_ALL.message,
      file:    PRIV_ALL.file,
      member:  PRIV_ALL.member,
      domain:  PRIV_ALL.domain,
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
             | PRIV.BASE.MENTION_GLOBAL,
      system:  0,
      discuss: PRIV.DISCUSS.VIEW
             | PRIV.DISCUSS.CREATE
             | PRIV.DISCUSS.EDIT_OWN
             | PRIV.DISCUSS.DELETE_OWN,
      message: PRIV.MESSAGE.SEND
             | PRIV.MESSAGE.ADD_REACTION
             | PRIV.MESSAGE.EDIT_OWN
             | PRIV.MESSAGE.DELETE_OWN
             | PRIV.MESSAGE.REVOKE_OWN,
      file:    PRIV.FILE.VIEW
             | PRIV.FILE.UPLOAD
             | PRIV.FILE.DELETE_OWN,
      member:  0,
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

// ============================================================
// 权限元信息（PRIV 展示用）
// ============================================================
const PRIV_GROUPS = [
  // ============ 基础 ============
  { group: 'base', groupLabel: '基础', dual: false,
    bit: PRIV.BASE.USER_PROFILE, key: 'base.user_profile',
    name: '基础权限', desc: '登录用户的最低权限，关闭后会被降级为访客' },
  { group: 'base', groupLabel: '基础', dual: false,
    bit: PRIV.BASE.CREATE_DOMAIN, key: 'base.create_domain',
    name: '创建域', desc: '允许用户创建新的域' },
  { group: 'base', groupLabel: '基础', dual: false,
    bit: PRIV.BASE.VIEW_ALL_DOMAIN, key: 'base.view_all_domain',
    name: '查看所有域', desc: '允许访问自己未加入的域（只读）' },
  { group: 'base', groupLabel: '基础', dual: false,
    bit: PRIV.BASE.SEND_DM, key: 'base.send_dm',
    name: '发送私信', desc: '允许发起私信' },
  { group: 'base', groupLabel: '基础', dual: false,
    bit: PRIV.BASE.UPLOAD_FILE, key: 'base.upload_file',
    name: '上传文件（用户空间）', desc: '允许上传到「我的文件」和私信附件' },
  { group: 'base', groupLabel: '基础', dual: false,
    bit: PRIV.BASE.MENTION_GLOBAL, key: 'base.mention_global',
    name: '全局提及', desc: '允许 @ 非本域成员（需同时拥有域内提及权限）' },

  // ============ 系统 ============
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.MANAGE_PANEL, key: 'system.manage_panel',
    name: '访问系统管理', desc: '允许访问 /manage 系列页面' },
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.EDIT_SETTINGS, key: 'system.edit_settings',
    name: '编辑系统设置', desc: '修改站点名称、公告、注册开关等' },
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.MANAGE_USERS, key: 'system.manage_users',
    name: '管理全局用户', desc: '封禁/解封用户、修改用户系统角色' },
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.MANAGE_DOMAINS, key: 'system.manage_domains',
    name: '管理所有域', desc: '管理所有域的成员、讨论、文件（不含系统设置）' },
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.MANAGE_ALL, key: 'system.manage_all',
    name: '超级管理员', desc: '最高权限，不可被降级' },

  // ============ 讨论 ============
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.VIEW, key: 'discuss.view',
    name: '查看讨论', desc: '允许查看讨论区（需同时拥有域内「查看讨论」权限）' },
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.CREATE, key: 'discuss.create',
    name: '创建讨论', desc: '允许创建新讨论' },
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.EDIT, key: 'discuss.edit',
    name: '编辑任意讨论', desc: '修改任何讨论的标题' },
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.EDIT_OWN, key: 'discuss.edit_own',
    name: '编辑自己的讨论', desc: '修改自己创建的讨论标题' },
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.DELETE, key: 'discuss.delete',
    name: '删除任意讨论', desc: '删除任何讨论（含他人创建）' },
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.DELETE_OWN, key: 'discuss.delete_own',
    name: '删除自己的讨论', desc: '删除自己创建的讨论' },
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.PIN, key: 'discuss.pin',
    name: '置顶讨论', desc: '置顶/取消置顶讨论' },

  // ============ 消息 ============
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.SEND, key: 'message.send',
    name: '发送消息', desc: '在讨论区发送消息' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.ADD_REACTION, key: 'message.add_reaction',
    name: '添加表情', desc: '对消息添加/移除表情回应' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.EDIT_OWN, key: 'message.edit_own',
    name: '编辑自己的消息', desc: '编辑自己发送的消息' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.DELETE_OWN, key: 'message.delete_own',
    name: '删除自己的消息', desc: '删除自己发送的消息' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.DELETE_ANY, key: 'message.delete_any',
    name: '删除任意消息', desc: '删除他人发送的消息' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.REVOKE_OWN, key: 'message.revoke_own',
    name: '撤回自己的消息', desc: '撤回自己发送的消息（保留占位）' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.REVOKE_ANY, key: 'message.revoke_any',
    name: '撤回任意消息', desc: '撤回他人发送的消息' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.PIN, key: 'message.pin',
    name: '置顶消息', desc: '置顶/取消置顶消息' },

  // ============ 文件 ============
  { group: 'file', groupLabel: '文件', dual: true,
    bit: PRIV.FILE.VIEW, key: 'file.view',
    name: '查看文件', desc: '查看和下载域内文件' },
  { group: 'file', groupLabel: '文件', dual: true,
    bit: PRIV.FILE.UPLOAD, key: 'file.upload',
    name: '上传文件（域空间）', desc: '上传文件到域内' },
  { group: 'file', groupLabel: '文件', dual: true,
    bit: PRIV.FILE.DELETE_OWN, key: 'file.delete_own',
    name: '删除自己的文件', desc: '删除自己上传的域内文件' },
  { group: 'file', groupLabel: '文件', dual: true,
    bit: PRIV.FILE.DELETE_ANY, key: 'file.delete_any',
    name: '删除任意文件', desc: '删除他人上传的域内文件' },

  // ============ 成员 ============
  { group: 'member', groupLabel: '成员', dual: true,
    bit: PRIV.MEMBER.MUTE, key: 'member.mute',
    name: '禁言成员', desc: '在域内禁言/解禁成员' },
  { group: 'member', groupLabel: '成员', dual: true,
    bit: PRIV.MEMBER.KICK, key: 'member.kick',
    name: '踢出成员', desc: '从域内踢出、封禁成员' },
  { group: 'member', groupLabel: '成员', dual: true,
    bit: PRIV.MEMBER.MANAGE_USER, key: 'member.manage_user',
    name: '管理域成员', desc: '分配角色、执行成员管理操作' },
  { group: 'member', groupLabel: '成员', dual: true,
    bit: PRIV.MEMBER.MANAGE_ROLE, key: 'member.manage_role',
    name: '管理域角色', desc: '创建、删除域角色并配置权限' },

  // ============ 域设置 ============
  { group: 'domain', groupLabel: '域设置', dual: true,
    bit: PRIV.DOMAIN.EDIT, key: 'domain.edit',
    name: '编辑域设置', desc: '修改域显示名、公告' },
  { group: 'domain', groupLabel: '域设置', dual: true,
    bit: PRIV.DOMAIN.MANAGE_JOIN, key: 'domain.manage_join',
    name: '管理加入方式', desc: '修改加入策略、审批申请' },
  { group: 'domain', groupLabel: '域设置', dual: true,
    bit: PRIV.DOMAIN.TRANSFER, key: 'domain.transfer',
    name: '转让所有权', desc: '将域转让给其他成员' },
  { group: 'domain', groupLabel: '域设置', dual: true,
    bit: PRIV.DOMAIN.DELETE, key: 'domain.delete',
    name: '删除域', desc: '彻底删除域' },
];

// ============================================================
// 位运算工具
// ============================================================
const PERM_IMPLIES = [
  [PERM.MANAGE_USER, PERM.MUTE_MEMBER | PERM.KICK_MEMBER],
  [PERM.KICK_MEMBER, PERM.MUTE_MEMBER],
  [PERM.MANAGE_DISCUSSION,
    PERM.CREATE_DISCUSSION | PERM.DELETE_DISCUSSION
    | PERM.PIN_DISCUSSION | PERM.EDIT_DISCUSSION],
];

function expandPerm(perm) {
  let r = perm || 0;
  for (const [src, extra] of PERM_IMPLIES) {
    if (r & src) r |= extra;
  }
  return r;
}

/**
 * 检查用户在某组是否有某权限
 * @param {object} user  - { privs: { base, system, discuss, ... } }
 * @param {string} group - 'base' / 'system' / 'discuss' / 'message' / 'file' / 'member' / 'domain'
 * @param {number} bit   - PRIV.<GROUP>.<XXX>
 */
function hasPriv(user, group, bit) {
  if (!user || !user.privs) return false;
  const g = user.privs[group];
  if (typeof g !== 'number') return false;
  return (g & bit) === bit;
}

/**
 * 检查用户在某组是否拥有 mask 中的任意一位（OR 语义）
 */
function hasPrivAny(user, group, mask) {
  if (!user || !user.privs) return false;
  const g = user.privs[group];
  if (typeof g !== 'number') return false;
  return (g & mask) !== 0;
}

// 【临时兼容】旧签名 hasPriv(userPriv, bit) 的桥接
// 如果第一个参数是数字，就当作 base 组的位掩码
function hasPrivLegacy(userPrivOrUser, bit, maybeBit) {
  if (typeof userPrivOrUser === 'number') {
    return (userPrivOrUser & maybeBit) === maybeBit;
  }
  return hasPriv(userPrivOrUser, bit, maybeBit);
}

function hasPerm(userPerm, p) { return (expandPerm(userPerm) & p) === p; }

// ============================================================
// 双检映射：操作需要 PRIV 和 PERM 同时满足
// ============================================================
const DUAL_CHECK = {
  // 讨论
  'view_discussion':   { priv: { group: 'discuss', bit: PRIV.DISCUSS.VIEW },       perm: PERM.VIEW_DISCUSSION,   label: '查看讨论' },
  'create_discussion': { priv: { group: 'discuss', bit: PRIV.DISCUSS.CREATE },     perm: PERM.CREATE_DISCUSSION, label: '创建讨论' },
  'edit_discussion':   { priv: { group: 'discuss', bit: PRIV.DISCUSS.EDIT },       perm: PERM.EDIT_DISCUSSION,   label: '编辑讨论' },
  'delete_discussion': { priv: { group: 'discuss', bit: PRIV.DISCUSS.DELETE },     perm: PERM.DELETE_DISCUSSION, label: '删除讨论' },
  'pin_discussion':    { priv: { group: 'discuss', bit: PRIV.DISCUSS.PIN },        perm: PERM.PIN_DISCUSSION,    label: '置顶讨论' },

  // 消息
  'send_message':      { priv: { group: 'message', bit: PRIV.MESSAGE.SEND },       perm: PERM.SEND_MESSAGE,      label: '发送消息' },
  'add_reaction':      { priv: { group: 'message', bit: PRIV.MESSAGE.ADD_REACTION }, perm: PERM.ADD_REACTION,    label: '添加表情' },
  'delete_message':    { priv: { group: 'message', bit: PRIV.MESSAGE.DELETE_OWN | PRIV.MESSAGE.DELETE_ANY }, perm: PERM.DELETE_OWN_MESSAGE | PERM.DELETE_ANY_MESSAGE, label: '删除消息' },
  'revoke_message':    { priv: { group: 'message', bit: PRIV.MESSAGE.REVOKE_OWN | PRIV.MESSAGE.REVOKE_ANY }, perm: PERM.REVOKE_OWN_MESSAGE | PERM.REVOKE_ANY_MESSAGE, label: '撤回消息' },
  'pin_message':       { priv: { group: 'message', bit: PRIV.MESSAGE.PIN },        perm: PERM.PIN_MESSAGE,       label: '置顶消息' },

  // 文件
  'view_file':         { priv: { group: 'file', bit: PRIV.FILE.VIEW },             perm: PERM.VIEW_FILE,         label: '查看文件' },
  'upload_file':       { priv: { group: 'file', bit: PRIV.FILE.UPLOAD },           perm: PERM.UPLOAD_FILE,       label: '上传文件' },
  'delete_file':       { priv: { group: 'file', bit: PRIV.FILE.DELETE_OWN | PRIV.FILE.DELETE_ANY }, perm: PERM.DELETE_OWN_FILE | PERM.DELETE_ANY_FILE, label: '删除文件' },

  // 成员
  'mute_member':       { priv: { group: 'member', bit: PRIV.MEMBER.MUTE },         perm: PERM.MUTE_MEMBER,       label: '禁言成员' },
  'kick_member':       { priv: { group: 'member', bit: PRIV.MEMBER.KICK },         perm: PERM.KICK_MEMBER,       label: '踢出成员' },
  'manage_user':       { priv: { group: 'member', bit: PRIV.MEMBER.MANAGE_USER },  perm: PERM.MANAGE_USER,       label: '管理域成员' },
  'manage_role':       { priv: { group: 'member', bit: PRIV.MEMBER.MANAGE_ROLE },  perm: PERM.MANAGE_ROLE,       label: '管理域角色' },

  // 域设置
  'edit_domain':       { priv: { group: 'domain', bit: PRIV.DOMAIN.EDIT },         perm: PERM.EDIT_DOMAIN,       label: '编辑域' },
  'manage_join':       { priv: { group: 'domain', bit: PRIV.DOMAIN.MANAGE_JOIN },  perm: PERM.MANAGE_USER,       label: '管理加入' },
  'transfer_domain':   { priv: { group: 'domain', bit: PRIV.DOMAIN.TRANSFER },     perm: PERM.MANAGE_USER,       label: '转让域' },
  'delete_domain':     { priv: { group: 'domain', bit: PRIV.DOMAIN.DELETE },       perm: PERM.MANAGE_USER,       label: '删除域' },
};

// TODO(批次 3): checkDual 需要根据 DUAL_CHECK.priv.group 和 bit 调用新的 hasPriv

module.exports = {
  PRIV, PRIV_ALL, PRIV_GROUPS, makePrivAll,
  PERM, PERM_NAMES, PERM_IMPLIES, BUILTIN_ROLES, SYSTEM_ROLES_BUILTIN,
  DUAL_CHECK,
  hasPriv, hasPrivAny, hasPerm, expandPerm,
};
'use strict';
const PRIV = {
// 基础
  BASE: {
    USER_PROFILE:       1 << 0,
    CREATE_DOMAIN:      1 << 1,
    VIEW_ALL_DOMAIN:    1 << 2,
    SEND_DM:            1 << 3,
    UPLOAD_FILE:        1 << 4,
    MENTION_GLOBAL:     1 << 5,
    UPLOAD_AVATAR:      1 << 6,
  },

// 系统
  SYSTEM: {
    MANAGE_PANEL:       1 << 0,
    EDIT_SETTINGS:      1 << 1,
    MANAGE_USERS:       1 << 2,
    MANAGE_DOMAINS:     1 << 3,
    MANAGE_ALL:         1 << 4,
    MANAGE_SYS_ROLES:   1 << 5,
    MANAGE_SYS_PERMS:   1 << 6,
    MANAGE_IP_BANS:     1 << 7,
  },

// 讨论（域级，双检）
  DISCUSS: {
    VIEW:               1 << 0,
    CREATE:             1 << 1,
    EDIT:               1 << 2,
    EDIT_OWN:           1 << 3,
    DELETE:             1 << 4,
    DELETE_OWN:         1 << 5,
    PIN:                1 << 6,
  },

// 消息（域级，双检）
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

// 文件（域级，双检）
  FILE: {
    VIEW:               1 << 0,
    UPLOAD:             1 << 1,
    DELETE_OWN:         1 << 2,
    DELETE_ANY:         1 << 3,
  },

// 成员（域级，双检）
  MEMBER: {
    MUTE:               1 << 0,
    KICK:               1 << 1,
    MANAGE_USER:        1 << 2,
    MANAGE_ROLE:        1 << 3,
    MANAGE_PERM:        1 << 4,
  },

// 域设置（域级，双检）
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

// 返回全新对象
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

// 权限元信息
const PRIV_GROUPS = [
// 基础
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
    name: '全局提及', desc: '允许 @ 非本域成员' },
  { group: 'base', groupLabel: '基础', dual: false,
    bit: PRIV.BASE.UPLOAD_AVATAR, key: 'base.upload_avatar',
    name: '上传头像', desc: '允许设置自己的头像图片' },

// 系统
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
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.MANAGE_SYS_ROLES, key: 'system.manage_sys_roles',
    name: '管理系统角色', desc: '创建、删除、编辑系统角色（角色决定别人能拿哪些系统权限）' },
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.MANAGE_SYS_PERMS, key: 'system.manage_sys_perms',
    name: '管理系统权限', desc: '勾选各系统角色的全局权限矩阵' },
  { group: 'system', groupLabel: '系统', dual: false,
    bit: PRIV.SYSTEM.MANAGE_IP_BANS, key: 'system.manage_ip_bans',
    name: '管理 IP 封禁', desc: '按 IP / 通配 / 范围封禁与解封' },

// 讨论
  { group: 'discuss', groupLabel: '讨论', dual: true,
    bit: PRIV.DISCUSS.VIEW, key: 'discuss.view',
    name: '查看讨论', desc: '允许查看讨论区' },
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

// 消息
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
    name: '撤回自己的消息', desc: '撤回自己发送的消息' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.REVOKE_ANY, key: 'message.revoke_any',
    name: '撤回任意消息', desc: '撤回他人发送的消息' },
  { group: 'message', groupLabel: '消息', dual: true,
    bit: PRIV.MESSAGE.PIN, key: 'message.pin',
    name: '置顶消息', desc: '置顶/取消置顶消息' },

// 文件
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

// 成员
  { group: 'member', groupLabel: '域成员', dual: true,
    bit: PRIV.MEMBER.MUTE, key: 'member.mute',
    name: '禁言成员', desc: '在域内禁言/解禁成员' },
  { group: 'member', groupLabel: '域成员', dual: true,
    bit: PRIV.MEMBER.KICK, key: 'member.kick',
    name: '踢出成员', desc: '从域内踢出、封禁成员' },
  { group: 'member', groupLabel: '域成员', dual: true,
    bit: PRIV.MEMBER.MANAGE_USER, key: 'member.manage_user',
    name: '管理成员', desc: '分配角色、执行成员管理操作' },
  { group: 'member', groupLabel: '域成员', dual: true,
    bit: PRIV.MEMBER.MANAGE_ROLE, key: 'member.manage_role',
    name: '管理角色', desc: '创建、删除域角色并配置权限' },
  { group: 'member', groupLabel: '域成员', dual: false,
    bit: PRIV.MEMBER.MANAGE_PERM, key: 'member.manage_perm',
    name: '管理域权限', desc: '允许配置域内各角色的权限矩阵' },

// 域设置
  { group: 'domain', groupLabel: '域管理', dual: true,
    bit: PRIV.DOMAIN.EDIT, key: 'domain.edit',
    name: '编辑域设置', desc: '修改域显示名、公告' },
  { group: 'domain', groupLabel: '域管理', dual: true,
    bit: PRIV.DOMAIN.MANAGE_JOIN, key: 'domain.manage_join',
    name: '管理加入方式', desc: '修改加入策略、审批申请' },
  { group: 'domain', groupLabel: '域管理', dual: true,
    bit: PRIV.DOMAIN.TRANSFER, key: 'domain.transfer',
    name: '转让所有权', desc: '将域转让给其他成员' },
  { group: 'domain', groupLabel: '域管理', dual: true,
    bit: PRIV.DOMAIN.DELETE, key: 'domain.delete',
    name: '删除域', desc: '彻底删除域' },
];

// 检查用户在某组是否有某权限
function hasPriv(user, group, bit) {
  if (!user || !user.privs) return false;
  const g = user.privs[group];
  if (typeof g !== 'number') return false;
  return (g & bit) === bit;
}

// 检查用户在某组是否有 mask 中的任意一位（OR 语义）
function hasPrivAny(user, group, mask) {
  if (!user || !user.privs) return false;
  const g = user.privs[group];
  if (typeof g !== 'number') return false;
  return (g & mask) !== 0;
}

module.exports = {
    PRIV, PRIV_ALL, makePrivAll, PRIV_GROUPS, hasPriv, hasPrivAny,
};

'use strict';

// ============================================================
// 用户级权限位（PRIV）
// ============================================================
const PRIV = {
    NONE:              0,
    USER_PROFILE:      1 << 0,
    REGISTER_USER:     1 << 1,   // 保留但不再使用
    CREATE_DOMAIN:     1 << 2,
    VIEW_ALL_DOMAIN:   1 << 3,
    MANAGE_ALL_DOMAIN: 1 << 4,
    EDIT_SYSTEM:       1 << 5,
    SEND_MESSAGE:      1 << 6,
    UNLIMITED_ACCESS:  1 << 7,
    MANAGE_SYSTEM:     1 << 8,
    MANAGE_USERS:      1 << 9,
    MANAGE_DOMAINS:    1 << 10,
    SEND_DM:           1 << 11,
    UPLOAD_FILE:       1 << 12,
    MENTION_GLOBAL:    1 << 13,

    // 域内动作的全局开关（新增）
    VIEW_DISCUSSION:   1 << 14,
    CREATE_DISCUSSION: 1 << 15,
    MANAGE_DISCUSSION: 1 << 16,
    ADD_REACTION:      1 << 17,
    DELETE_MESSAGE:    1 << 18,
    REVOKE_MESSAGE:    1 << 19,
    PIN_MESSAGE:       1 << 20,
    MUTE_MEMBER:       1 << 21,
    KICK_MEMBER:       1 << 22,
    VIEW_FILE:         1 << 23,
    DELETE_FILE:       1 << 24,
    EDIT_DOMAIN:       1 << 25,
    MANAGE_ROLE:       1 << 26,
    MANAGE_USER:       1 << 27,
};
PRIV.ALL = (1 << 28) - 1;

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
        priv: PRIV.ALL,
        editable: false,
    },
    admin: {
        display: '系统管理员',
        priv: PRIV.ALL & ~PRIV.MANAGE_ALL_DOMAIN,  // 除超管位以外全开
        editable: true,
    },
    member: {
        display: '普通用户',
        priv: PRIV.USER_PROFILE | PRIV.CREATE_DOMAIN | PRIV.VIEW_ALL_DOMAIN
            | PRIV.SEND_MESSAGE | PRIV.SEND_DM | PRIV.MENTION_GLOBAL
            | PRIV.UPLOAD_FILE
            | PRIV.VIEW_DISCUSSION | PRIV.CREATE_DISCUSSION
            | PRIV.ADD_REACTION | PRIV.DELETE_MESSAGE | PRIV.REVOKE_MESSAGE
            | PRIV.VIEW_FILE | PRIV.DELETE_FILE,
        editable: true,
    },
    guest: {
        display: '访客',
        priv: PRIV.USER_PROFILE,
        editable: true,
    },
};

// ============================================================
// 权限元信息（PRIV 展示用）
// ============================================================
const PRIV_NAMES = [
  // 一般
  { bit: PRIV.USER_PROFILE,      name: '基础权限',
    desc: '登录用户的最低权限，关闭后会被降级为访客，无法使用大部分功能',
    group: '一般' },
  { bit: PRIV.CREATE_DOMAIN,     name: '创建域',
    desc: '允许用户创建新的域',
    group: '一般' },
  { bit: PRIV.VIEW_ALL_DOMAIN,   name: '查看所有域',
    desc: '允许访问自己未加入的域（只读）',
    group: '一般' },

  // 讨论
  { bit: PRIV.VIEW_DISCUSSION,   name: '查看讨论',
    desc: '允许查看讨论区（需同时拥有域内「查看讨论」权限）',
    group: '讨论' },
  { bit: PRIV.CREATE_DISCUSSION, name: '创建讨论',
    desc: '允许创建新讨论（需同时拥有域内「创建讨论」权限）',
    group: '讨论' },
  { bit: PRIV.MANAGE_DISCUSSION, name: '管理讨论',
    desc: '允许编辑、删除、置顶讨论（需同时拥有域内对应权限）',
    group: '讨论' },

  // 消息
  { bit: PRIV.SEND_MESSAGE,      name: '发送消息',
    desc: '在域内讨论区发送消息（需同时拥有域内「发送消息」权限）',
    group: '消息' },
  { bit: PRIV.ADD_REACTION,      name: '添加表情',
    desc: '允许对消息添加表情回应',
    group: '消息' },
  { bit: PRIV.DELETE_MESSAGE,    name: '删除消息',
    desc: '允许删除消息（含他人消息，实际以域内权限为准）',
    group: '消息' },
  { bit: PRIV.REVOKE_MESSAGE,    name: '撤回消息',
    desc: '允许撤回消息（含他人消息，实际以域内权限为准）',
    group: '消息' },
  { bit: PRIV.PIN_MESSAGE,       name: '置顶消息',
    desc: '允许置顶消息',
    group: '消息' },
  { bit: PRIV.MUTE_MEMBER,       name: '禁言成员',
    desc: '允许在域内禁言成员',
    group: '消息' },
  { bit: PRIV.KICK_MEMBER,       name: '踢出成员',
    desc: '允许从域内踢出成员',
    group: '消息' },
  { bit: PRIV.SEND_DM,           name: '发送私信',
    desc: '允许发起私信',
    group: '消息' },
  { bit: PRIV.MENTION_GLOBAL,    name: '全局提及',
    desc: '允许 @ 非本域成员（需同时拥有域内「提及成员」权限）',
    group: '消息' },

  // 文件
  { bit: PRIV.VIEW_FILE,         name: '查看文件',
    desc: '允许查看域内文件',
    group: '文件' },
  { bit: PRIV.UPLOAD_FILE,       name: '上传文件',
    desc: '允许上传文件（域内需同时拥有域内「上传文件」权限）',
    group: '文件' },
  { bit: PRIV.DELETE_FILE,       name: '删除文件',
    desc: '允许删除文件（含他人文件，实际以域内权限为准）',
    group: '文件' },

  // 管理
  { bit: PRIV.EDIT_DOMAIN,       name: '编辑域设置',
    desc: '允许修改域显示名、公告等',
    group: '管理' },
  { bit: PRIV.MANAGE_ROLE,       name: '管理角色',
    desc: '允许创建、删除域角色并配置权限',
    group: '管理' },
  { bit: PRIV.MANAGE_USER,       name: '管理域成员',
    desc: '允许分配角色、禁言、踢出域成员',
    group: '管理' },
  { bit: PRIV.EDIT_SYSTEM,       name: '编辑系统设置',
    desc: '允许修改站点名称、公告等系统配置',
    group: '管理' },
  { bit: PRIV.MANAGE_SYSTEM,     name: '系统管理',
    desc: '允许访问系统管理页面',
    group: '管理' },
  { bit: PRIV.MANAGE_USERS,      name: '管理全局用户',
    desc: '允许封禁/解封用户、修改用户系统角色',
    group: '管理' },
  { bit: PRIV.MANAGE_DOMAINS,    name: '管理所有域',
    desc: '允许管理所有域的成员、讨论、文件（不含系统设置）',
    group: '管理' },
  { bit: PRIV.MANAGE_ALL_DOMAIN, name: '超级管理员',
    desc: '最高权限，不可被降级',
    group: '管理' },
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

function hasPriv(userPriv, p) { return (userPriv & p) === p; }
function hasPerm(userPerm, p) { return (expandPerm(userPerm) & p) === p; }

// ============================================================
// 双检映射：操作需要 PRIV 和 PERM 同时满足
// ============================================================
const DUAL_CHECK = {
    // 讨论
    'view_discussion':   { priv: PRIV.VIEW_DISCUSSION,   perm: PERM.VIEW_DISCUSSION,   label: '查看讨论' },
    'create_discussion': { priv: PRIV.CREATE_DISCUSSION, perm: PERM.CREATE_DISCUSSION, label: '创建讨论' },
    'edit_discussion':   { priv: PRIV.MANAGE_DISCUSSION, perm: PERM.EDIT_DISCUSSION,   label: '编辑讨论' },
    'delete_discussion': { priv: PRIV.MANAGE_DISCUSSION, perm: PERM.DELETE_DISCUSSION, label: '删除讨论' },
    'pin_discussion':    { priv: PRIV.MANAGE_DISCUSSION, perm: PERM.PIN_DISCUSSION,    label: '置顶讨论' },

    // 消息
    'send_message':      { priv: PRIV.SEND_MESSAGE,      perm: PERM.SEND_MESSAGE,      label: '发送消息' },
    'add_reaction':      { priv: PRIV.ADD_REACTION,      perm: PERM.ADD_REACTION,      label: '添加表情' },
    'delete_message':    { priv: PRIV.DELETE_MESSAGE,
                           perm: PERM.DELETE_OWN_MESSAGE | PERM.DELETE_ANY_MESSAGE,    label: '删除消息' },
    'revoke_message':    { priv: PRIV.REVOKE_MESSAGE,
                           perm: PERM.REVOKE_OWN_MESSAGE | PERM.REVOKE_ANY_MESSAGE,    label: '撤回消息' },
    'pin_message':       { priv: PRIV.PIN_MESSAGE,       perm: PERM.PIN_MESSAGE,       label: '置顶消息' },
    'mute_member':       { priv: PRIV.MUTE_MEMBER,       perm: PERM.MUTE_MEMBER,       label: '禁言成员' },
    'kick_member':       { priv: PRIV.KICK_MEMBER,       perm: PERM.KICK_MEMBER,       label: '踢出成员' },

    // 文件
    'view_file':         { priv: PRIV.VIEW_FILE,         perm: PERM.VIEW_FILE,         label: '查看文件' },
    'upload_file':       { priv: PRIV.UPLOAD_FILE,       perm: PERM.UPLOAD_FILE,       label: '上传文件' },
    'delete_file':       { priv: PRIV.DELETE_FILE,
                           perm: PERM.DELETE_OWN_FILE | PERM.DELETE_ANY_FILE,          label: '删除文件' },

    // 管理
    'edit_domain':       { priv: PRIV.EDIT_DOMAIN,       perm: PERM.EDIT_DOMAIN,       label: '编辑域' },
    'manage_role':       { priv: PRIV.MANAGE_ROLE,       perm: PERM.MANAGE_ROLE,       label: '管理角色' },
    'manage_user':       { priv: PRIV.MANAGE_USER,       perm: PERM.MANAGE_USER,       label: '管理域成员' },
};

module.exports = { PRIV, PERM, PERM_NAMES, PRIV_NAMES, BUILTIN_ROLES, SYSTEM_ROLES_BUILTIN, DUAL_CHECK, hasPriv, hasPerm, expandPerm };

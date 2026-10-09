'use strict';

// ============================================================
// 用户级权限位（PRIV）
// ============================================================
const PRIV = {
    NONE:              0,
    EDIT_SYSTEM:       1 << 0,
    SET_PERM:          1 << 1,
    USER_PROFILE:      1 << 2,
    REGISTER_USER:     1 << 3,
    CREATE_DOMAIN:     1 << 4,
    VIEW_ALL_DOMAIN:   1 << 5,
    MANAGE_ALL_DOMAIN: 1 << 6,
    SEND_MESSAGE:      1 << 7,
    UNLIMITED_ACCESS:  1 << 8,
    MANAGE_SYSTEM:     1 << 9,
    MANAGE_USERS:      1 << 10,
    MANAGE_DOMAINS:    1 << 11,
    SEND_DM:           1 << 12,
    UPLOAD_FILE:       1 << 13,
    MENTION_GLOBAL:    1 << 14,
};
PRIV.ALL = (1 << 15) - 1;

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
    { bit: PERM.VIEW,                   name: '查看域',         group: '一般' },
    { bit: PERM.VIEW_USER_PRIVATE_INFO, name: '查看隐私信息',   group: '一般' },
    { bit: PERM.EDIT_DOMAIN,            name: '编辑域',         group: '一般' },
    { bit: PERM.MOD_BADGE,              name: 'MOD 徽章',       group: '一般' },

    { bit: PERM.VIEW_DISCUSSION,        name: '查看讨论',       group: '讨论' },
    { bit: PERM.CREATE_DISCUSSION,      name: '创建讨论',       group: '讨论' },
    { bit: PERM.PIN_DISCUSSION,         name: '置顶讨论',       group: '讨论' },
    { bit: PERM.EDIT_DISCUSSION,        name: '编辑任意讨论',   group: '讨论' },
    { bit: PERM.EDIT_OWN_DISCUSSION,    name: '编辑自己的讨论', group: '讨论' },
    { bit: PERM.DELETE_DISCUSSION,      name: '删除任意讨论',   group: '讨论' },
    { bit: PERM.DELETE_OWN_DISCUSSION,  name: '删除自己的讨论', group: '讨论' },
    { bit: PERM.MANAGE_DISCUSSION,      name: '管理讨论',       group: '讨论' },

    { bit: PERM.SEND_MESSAGE,           name: '发送消息',       group: '消息' },
    { bit: PERM.ADD_REACTION,           name: '添加表情',       group: '消息' },
    { bit: PERM.EDIT_OWN_MESSAGE,       name: '编辑自己的消息', group: '消息' },
    { bit: PERM.DELETE_OWN_MESSAGE,     name: '删除自己的消息', group: '消息' },
    { bit: PERM.DELETE_ANY_MESSAGE,     name: '删除任意消息',   group: '消息' },
    { bit: PERM.PIN_MESSAGE,            name: '置顶消息',       group: '消息' },
    { bit: PERM.MUTE_MEMBER,            name: '禁言成员',       group: '管理' },
    { bit: PERM.KICK_MEMBER,            name: '踢出成员',       group: '管理' },
    { bit: PERM.REVOKE_OWN_MESSAGE,     name: '撤回自己的消息', group: '消息' },
    { bit: PERM.REVOKE_ANY_MESSAGE,     name: '撤回任意消息',   group: '消息' },
    { bit: PERM.MENTION_MEMBER,         name: '提及成员',       group: '消息' },

    { bit: PERM.VIEW_FILE,              name: '查看文件',       group: '文件' },
    { bit: PERM.UPLOAD_FILE,            name: '上传文件',       group: '文件' },
    { bit: PERM.DELETE_ANY_FILE,        name: '删除任意文件',   group: '文件' },
    { bit: PERM.DELETE_OWN_FILE,        name: '删除自己的文件', group: '文件' },

    { bit: PERM.MANAGE_ROLE,            name: '管理角色',       group: '管理' },
    { bit: PERM.MANAGE_USER,            name: '管理用户',       group: '管理' },
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
        priv: PRIV.EDIT_SYSTEM | PRIV.MANAGE_SYSTEM | PRIV.MANAGE_USERS
            | PRIV.MANAGE_DOMAINS | PRIV.VIEW_ALL_DOMAIN
            | PRIV.SEND_MESSAGE | PRIV.SEND_DM | PRIV.UPLOAD_FILE
            | PRIV.MENTION_GLOBAL | PRIV.CREATE_DOMAIN,
        editable: true,
    },
    member: {
        display: '普通用户',
        priv: PRIV.USER_PROFILE | PRIV.REGISTER_USER | PRIV.SEND_MESSAGE
            | PRIV.CREATE_DOMAIN | PRIV.SEND_DM | PRIV.UPLOAD_FILE
            | PRIV.MENTION_GLOBAL,
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
    { bit: PRIV.USER_PROFILE,      name: '使用个人资料',   group: '一般' },
    { bit: PRIV.REGISTER_USER,     name: '注册账号',       group: '一般' },
    { bit: PRIV.CREATE_DOMAIN,     name: '创建域',         group: '一般' },
    { bit: PRIV.VIEW_ALL_DOMAIN,   name: '查看所有域',     group: '一般' },
    { bit: PRIV.SEND_MESSAGE,      name: '发送消息',       group: '消息' },
    { bit: PRIV.SEND_DM,           name: '发送私信',       group: '消息' },
    { bit: PRIV.MENTION_GLOBAL,    name: '全局提及',       group: '消息' },
    { bit: PRIV.UPLOAD_FILE,       name: '上传文件',       group: '文件' },
    { bit: PRIV.EDIT_SYSTEM,       name: '编辑系统设置',   group: '管理' },
    { bit: PRIV.MANAGE_SYSTEM,     name: '系统管理',       group: '管理' },
    { bit: PRIV.MANAGE_USERS,      name: '管理用户',       group: '管理' },
    { bit: PRIV.MANAGE_DOMAINS,    name: '管理所有域',     group: '管理' },
    { bit: PRIV.MANAGE_ALL_DOMAIN, name: '超级管理员',     group: '管理' },
    { bit: PRIV.UNLIMITED_ACCESS,  name: '无限制访问',     group: '管理' },
];

// ============================================================
// 位运算工具
// ============================================================
const PERM_IMPLIES = [
    [PERM.MANAGE_USER, PERM.MUTE_MEMBER | PERM.KICK_MEMBER | PERM.VIEW_USER_PRIVATE_INFO],
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

module.exports = { PRIV, PERM, PERM_NAMES, PRIV_NAMES, BUILTIN_ROLES, SYSTEM_ROLES_BUILTIN, hasPriv, hasPerm, expandPerm };

'use strict';
// 本文件是 lib/permissions/ 的组成部分，由 index.js 统一再导出。
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
  { bit: PERM.VIEW_USER_PRIVATE_INFO, name: '查看用户私密信息', group: '一般',
    desc: '允许查看邮箱、注册 IP 等仅本人可见的资料' },
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
  { bit: PERM.EDIT_OWN_MESSAGE,       name: '编辑自己的消息', group: '消息',
    desc: '允许编辑自己发送的消息内容' },
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
// 位运算工具
// ============================================================
const PERM_IMPLIES = [
  [PERM.MANAGE_USER, PERM.MUTE_MEMBER | PERM.KICK_MEMBER],
  [PERM.KICK_MEMBER, PERM.MUTE_MEMBER],
  [PERM.MANAGE_DISCUSSION,
    PERM.CREATE_DISCUSSION | PERM.DELETE_DISCUSSION
    | PERM.PIN_DISCUSSION | PERM.EDIT_DISCUSSION],
];

// 必须迭代到不动点，不能单遍扫描。
// 单遍实现下 [[B,C],[A,B]] 这种顺序会让 A 拿不到 C，
// 也就是说 PERM_IMPLIES 的数组顺序会静默改变权限语义。
function expandPerm(perm) {
  let r = perm || 0;
  for (let pass = 0; pass < PERM_IMPLIES.length; pass++) {
    let changed = false;
    for (const [src, extra] of PERM_IMPLIES) {
      if (r & src) {
        const next = r | extra;
        if (next !== r) { r = next; changed = true; }
      }
    }
    if (!changed) break;   // 已达不动点
  }
  return r;
}

function hasPerm(userPerm, p) { return (expandPerm(userPerm) & p) === p; }

module.exports = {
    PERM, PERM_NAMES, PERM_IMPLIES, expandPerm, hasPerm,
};

'use strict';
const bits = require('./perm-bits');

const PERM = {
  VIEW:                    bits.bitByIndex(0),
  EDIT_DOMAIN:             bits.bitByIndex(1),
  MOD_BADGE:               bits.bitByIndex(2),
  VIEW_DISCUSSION:         bits.bitByIndex(3),
  CREATE_DISCUSSION:       bits.bitByIndex(4),
  PIN_DISCUSSION:          bits.bitByIndex(5),
  EDIT_DISCUSSION:         bits.bitByIndex(6),
  EDIT_OWN_DISCUSSION:     bits.bitByIndex(7),
  DELETE_DISCUSSION:       bits.bitByIndex(8),
  DELETE_OWN_DISCUSSION:   bits.bitByIndex(9),
  SEND_MESSAGE:            bits.bitByIndex(10),
  ADD_REACTION:            bits.bitByIndex(11),
  EDIT_OWN_MESSAGE:        bits.bitByIndex(12),
  DELETE_OWN_MESSAGE:      bits.bitByIndex(13),
  DELETE_ANY_MESSAGE:      bits.bitByIndex(14),
  PIN_MESSAGE:             bits.bitByIndex(15),
  MUTE_MEMBER:             bits.bitByIndex(16),
  KICK_MEMBER:             bits.bitByIndex(17),
  VIEW_FILE:               bits.bitByIndex(18),
  UPLOAD_FILE:             bits.bitByIndex(19),
  DELETE_ANY_FILE:         bits.bitByIndex(20),
  DELETE_OWN_FILE:         bits.bitByIndex(21),
  MANAGE_ROLE:             bits.bitByIndex(22),
  MANAGE_USER:             bits.bitByIndex(23),
  MANAGE_DISCUSSION:       bits.bitByIndex(24),
  REVOKE_OWN_MESSAGE:      bits.bitByIndex(25),
  REVOKE_ANY_MESSAGE:      bits.bitByIndex(26),
  MENTION_MEMBER:          bits.bitByIndex(27),
  MANAGE_JOIN_APPL:        bits.bitByIndex(28),
  TRANSFER_DOMAIN:         bits.bitByIndex(29),
  DELETE_DOMAIN:           bits.bitByIndex(30),
  // 从 MANAGE_ROLE 拆出：原先「角色管理」和「权限管理」共用一位，
  // 关掉任一个会连带另一个。
  MANAGE_PERM:             bits.bitByIndex(31),
};
// 全开 = 所有已定义位的并集，新增位自动包含
PERM.ALL = Object.keys(PERM).reduce((a, k) => bits.or(a, PERM[k]), { hi: 0, lo: 0 });
// 位号 0..31 放在低字，32..63 是高字，当前全部空着，留给后续新增权限。
// 全开 = 所有已定义位的并集，新增位自动包含（双字表示）
PERM.ALL = Object.keys(PERM).reduce(
    (a, k) => bits.or(a, PERM[k]), { hi: 0, lo: 0 });

// 权限元信息。index 是位序号：0..31 落在低字，32+ 落在高字
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
  { bit: PERM.MANAGE_PERM,             name: '管理权限',       group: '管理',
    desc: '允许勾选各域角色的权限（与「管理角色」分开授权）' },

  { bit: PERM.MANAGE_JOIN_APPL,       name: '审批加入申请',   group: '管理',
    desc: '允许通过/拒绝加入本域的申请' },
  { bit: PERM.TRANSFER_DOMAIN,        name: '转让域所有权',   group: '管理',
    desc: '允许把域转让给其他成员' },
  { bit: PERM.DELETE_DOMAIN,          name: '删除域',         group: '管理',
    desc: '允许彻底删除本域' },
];

// 位运算工具
// 给每项权限标注位序号（与 PERM 表声明顺序一致）。
// 序号即存储里的位位置：0..31 低字，32+ 高字。
// 序号一经分配不再变动，保证已落盘的权限值不会错位。
{
    const order = Object.keys(PERM).filter(k => k !== 'ALL');
    const idxOf = new Map();
    order.forEach((k, i) => idxOf.set(k, i));
    // PERM_NAMES 里的 bit 是 PERM.X 的引用，反查回键名
    for (const item of PERM_NAMES) {
        const key = order.find(k => PERM[k] === item.bit);
        item.index = key === undefined ? -1 : idxOf.get(key);
    }
}

// 蕴含关系：持有左边即自动获得右边
// 用 bits.or 构造，高位也能安全参与
const PERM_IMPLIES = [
  [PERM.MANAGE_USER, bits.or(PERM.MUTE_MEMBER, PERM.KICK_MEMBER)],
  [PERM.KICK_MEMBER, PERM.MUTE_MEMBER],
  [PERM.MANAGE_DISCUSSION,
    bits.or(bits.or(PERM.CREATE_DISCUSSION, PERM.DELETE_DISCUSSION),
      bits.or(PERM.PIN_DISCUSSION, PERM.EDIT_DISCUSSION))],
];

// 双字位运算：中间结果统一保持 { hi, lo }
function expandPerm(perm) {
  let r = bits.norm(perm);
  for (let pass = 0; pass < PERM_IMPLIES.length; pass++) {
    let changed = false;
    for (const [src, extra] of PERM_IMPLIES) {
      if (bits.has(r, src)) {
        const next = bits.or(r, extra);
        if (!bits.eq(next, r)) { r = next; changed = true; }
      }
    }
    if (!changed) break;   // 已达不动点
  }
  return r;
}

// 判定是否持有全部 p 位（p 可为数字或 { hi, lo }）
function hasPerm(userPerm, p) {
    return bits.has(expandPerm(userPerm), p);
}


module.exports = {
    PERM, PERM_NAMES, PERM_IMPLIES, expandPerm, hasPerm,
    bits,
};

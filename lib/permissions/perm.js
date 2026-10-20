'use strict';
const bits = require('./perm-bits');

// 域级权限位。分组结构与 PRIV 一致。
// 组内用局部序号，全局位号 = 各组容量依次累加（见 PERM_INDEX）。
// 低字 0..31，高字 32..63。
const PERM_GROUPS = {
  // 一般
  GENERAL: {
    VIEW:                 bits.bitByIndex(0),
    EDIT_DOMAIN:          bits.bitByIndex(1),
    MOD_BADGE:            bits.bitByIndex(2),
  },

  // 讨论
  DISCUSS: {
    VIEW:                 bits.bitByIndex(3),
    CREATE:               bits.bitByIndex(4),
    PIN:                  bits.bitByIndex(5),
    EDIT:                 bits.bitByIndex(6),
    EDIT_OWN:             bits.bitByIndex(7),
    DELETE:               bits.bitByIndex(8),
    DELETE_OWN:           bits.bitByIndex(9),
    MANAGE:               bits.bitByIndex(10),
  },

  // 消息
  MESSAGE: {
    SEND:                 bits.bitByIndex(11),
    ADD_REACTION:         bits.bitByIndex(12),
    EDIT_OWN:             bits.bitByIndex(13),
    DELETE_OWN:           bits.bitByIndex(14),
    DELETE_ANY:           bits.bitByIndex(15),
    REVOKE_OWN:           bits.bitByIndex(16),
    REVOKE_ANY:           bits.bitByIndex(17),
    PIN:                  bits.bitByIndex(18),
    MENTION_MEMBER:       bits.bitByIndex(19),
    MUTE_MEMBER:          bits.bitByIndex(20),
    KICK_MEMBER:          bits.bitByIndex(21),
  },

  // 文件
  FILE: {
    VIEW:                 bits.bitByIndex(22),
    UPLOAD:               bits.bitByIndex(23),
    DELETE_ANY:           bits.bitByIndex(24),
    DELETE_OWN:           bits.bitByIndex(25),
  },

  // 管理
  MANAGE: {
    ROLE:                 bits.bitByIndex(26),
    USER:                 bits.bitByIndex(27),
    PERM:                 bits.bitByIndex(28),
    JOIN_APPL:            bits.bitByIndex(29),
    TRANSFER:             bits.bitByIndex(30),
    DELETE:               bits.bitByIndex(31),
  },
};

// 对外暴露的分组结构
const PERM = PERM_GROUPS;

// 全开 = 所有已定义位的并集
// 注意：ALL 挂在 PERM 上只为方便取用，分组遍历一律用 PERM_GROUPS，
// 否则会把 ALL 当成"一组权限"再 or 一遍。
PERM.ALL = Object.values(PERM_GROUPS).reduce(function (a, group) {
    return Object.values(group).reduce(function (x, bit) { return bits.or(x, bit); }, a);
}, { hi: 0, lo: 0 });

// 权限元信息。index 是全局位序号，存储时即用此位置。
const PERM_NAMES = [
  { bit: PERM.GENERAL.VIEW,           name: '查看域',         group: '一般',
    desc: '允许访问域主页、成员列表' },
  { bit: PERM.GENERAL.EDIT_DOMAIN,    name: '编辑域',         group: '一般',
    desc: '允许修改域显示名、公告、加入方式' },
  { bit: PERM.GENERAL.MOD_BADGE,      name: 'MOD 徽章',       group: '一般',
    desc: '在消息和成员列表中显示 MOD 标识' },

  { bit: PERM.DISCUSS.VIEW,           name: '查看讨论',       group: '讨论',
    desc: '允许查看讨论区内容' },
  { bit: PERM.DISCUSS.CREATE,         name: '创建讨论',       group: '讨论',
    desc: '允许创建新的讨论' },
  { bit: PERM.DISCUSS.PIN,            name: '置顶讨论',       group: '讨论',
    desc: '允许置顶/取消置顶讨论' },
  { bit: PERM.DISCUSS.EDIT,           name: '编辑任意讨论',   group: '讨论',
    desc: '允许修改他人创建的讨论标题' },
  { bit: PERM.DISCUSS.EDIT_OWN,       name: '编辑自己的讨论', group: '讨论',
    desc: '允许修改自己创建的讨论标题' },
  { bit: PERM.DISCUSS.DELETE,         name: '删除任意讨论',   group: '讨论',
    desc: '允许删除任何讨论（含他人创建）' },
  { bit: PERM.DISCUSS.DELETE_OWN,     name: '删除自己的讨论', group: '讨论',
    desc: '允许删除自己创建的讨论' },
  { bit: PERM.DISCUSS.MANAGE,         name: '管理讨论',       group: '讨论',
    desc: '隐含创建/编辑/删除/置顶讨论的全部权限' },

  { bit: PERM.MESSAGE.SEND,           name: '发送消息',       group: '消息',
    desc: '允许在讨论区发送消息' },
  { bit: PERM.MESSAGE.ADD_REACTION,   name: '添加表情',       group: '消息',
    desc: '允许对消息添加/移除表情回应' },
  { bit: PERM.MESSAGE.EDIT_OWN,       name: '编辑自己的消息', group: '消息',
    desc: '允许编辑自己发送的消息内容' },
  { bit: PERM.MESSAGE.DELETE_OWN,     name: '删除自己的消息', group: '消息',
    desc: '允许删除自己发送的消息' },
  { bit: PERM.MESSAGE.DELETE_ANY,     name: '删除任意消息',   group: '消息',
    desc: '允许删除他人发送的消息' },
  { bit: PERM.MESSAGE.REVOKE_OWN,     name: '撤回自己的消息', group: '消息',
    desc: '撤回自己发送的消息（保留占位）' },
  { bit: PERM.MESSAGE.REVOKE_ANY,     name: '撤回任意消息',   group: '消息',
    desc: '允许撤回他人发送的消息' },
  { bit: PERM.MESSAGE.PIN,            name: '置顶消息',       group: '消息',
    desc: '允许置顶/取消置顶消息' },
  { bit: PERM.MESSAGE.MENTION_MEMBER, name: '提及成员',       group: '消息',
    desc: '允许 @ 本域成员（需同时拥有全局「全局提及」权限）' },
  { bit: PERM.MESSAGE.MUTE_MEMBER,    name: '禁言成员',       group: '消息',
    desc: '允许在域内禁言/解禁成员' },
  { bit: PERM.MESSAGE.KICK_MEMBER,    name: '踢出成员',       group: '消息',
    desc: '允许从域内踢出、封禁成员' },

  { bit: PERM.FILE.VIEW,              name: '查看文件',       group: '文件',
    desc: '允许查看和下载域内文件' },
  { bit: PERM.FILE.UPLOAD,            name: '上传文件',       group: '文件',
    desc: '允许上传文件到域空间' },
  { bit: PERM.FILE.DELETE_ANY,        name: '删除任意文件',   group: '文件',
    desc: '允许删除他人上传的文件' },
  { bit: PERM.FILE.DELETE_OWN,        name: '删除自己的文件', group: '文件',
    desc: '允许删除自己上传的文件' },

  { bit: PERM.MANAGE.ROLE,            name: '管理角色',       group: '管理',
    desc: '允许创建、删除域角色并配置权限' },
  { bit: PERM.MANAGE.USER,            name: '管理用户',       group: '管理',
    desc: '允许分配角色、禁言、踢出域成员（隐含禁言+踢出）' },
  { bit: PERM.MANAGE.PERM,            name: '管理权限',       group: '管理',
    desc: '允许勾选各域角色的权限（与「管理角色」分开授权）' },
  { bit: PERM.MANAGE.JOIN_APPL,       name: '审批加入申请',   group: '管理',
    desc: '允许通过/拒绝加入本域的申请' },
  { bit: PERM.MANAGE.TRANSFER,        name: '转让域所有权',   group: '管理',
    desc: '允许把域转让给其他成员' },
  { bit: PERM.MANAGE.DELETE,          name: '删除域',         group: '管理',
    desc: '允许彻底删除本域' },
];

// 给每项权限标注位序号：按 PERM 表分组顺序累加。
// 序号即存储里的位位置，一经分配不再变动。
{
    let idx = 0;
    for (const group of Object.values(PERM_GROUPS)) {
        for (const bit of Object.values(group)) {
            for (const item of PERM_NAMES) {
                if (bits.eq(item.bit, bit)) item.index = idx;
            }
            idx++;
        }
    }
}

// 蕴含关系：持有左边即自动获得右边
const PERM_IMPLIES = [
  [PERM.MANAGE.USER, bits.or(PERM.MESSAGE.MUTE_MEMBER, PERM.MESSAGE.KICK_MEMBER)],
  [PERM.MESSAGE.KICK_MEMBER, PERM.MESSAGE.MUTE_MEMBER],
  [PERM.DISCUSS.MANAGE,
    bits.or(bits.or(PERM.DISCUSS.CREATE, PERM.DISCUSS.DELETE),
      bits.or(PERM.DISCUSS.PIN, PERM.DISCUSS.EDIT))],
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
    if (!changed) break;
  }
  return r;
}

// 判定是否持有全部 p 位
function hasPerm(userPerm, p) {
    return bits.has(expandPerm(userPerm), p);
}

module.exports = {
    PERM, PERM_NAMES, PERM_IMPLIES, expandPerm, hasPerm,
    bits,
};
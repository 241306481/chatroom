'use strict';
// index 再导出
const { PRIV } = require('./priv');
const { PERM } = require('./perm');

// 双检映射表
const DUAL_CHECK = {
  // 讨论
  'view_discussion':   { priv: { group: 'discuss', bit: PRIV.DISCUSS.VIEW },       perm: PERM.DISCUSS.VIEW,   label: '查看讨论' },
  'create_discussion': { priv: { group: 'discuss', bit: PRIV.DISCUSS.CREATE },     perm: PERM.DISCUSS.CREATE, label: '创建讨论' },
  'edit_discussion':   { priv: { group: 'discuss', bit: PRIV.DISCUSS.EDIT },       perm: PERM.DISCUSS.EDIT,   label: '编辑讨论' },
  'delete_discussion': { priv: { group: 'discuss', bit: PRIV.DISCUSS.DELETE },     perm: PERM.DISCUSS.DELETE, label: '删除讨论' },
  'pin_discussion':    { priv: { group: 'discuss', bit: PRIV.DISCUSS.PIN },        perm: PERM.DISCUSS.PIN,    label: '置顶讨论' },

  // 消息
  'send_message':      { priv: { group: 'message', bit: PRIV.MESSAGE.SEND },       perm: PERM.MESSAGE.SEND,      label: '发送消息' },
  'add_reaction':      { priv: { group: 'message', bit: PRIV.MESSAGE.ADD_REACTION }, perm: PERM.MESSAGE.ADD_REACTION,    label: '添加表情' },
  'delete_message':    {
    priv:    { group: 'message', bit: PRIV.MESSAGE.DELETE_ANY },
    perm:    PERM.MESSAGE.DELETE_ANY,
    privOwn: { group: 'message', bit: PRIV.MESSAGE.DELETE_OWN },
    permOwn: PERM.MESSAGE.DELETE_OWN,
    label: '删除消息',
  },
  'revoke_message':    {
    priv:    { group: 'message', bit: PRIV.MESSAGE.REVOKE_ANY },
    perm:    PERM.MESSAGE.REVOKE_ANY,
    privOwn: { group: 'message', bit: PRIV.MESSAGE.REVOKE_OWN },
    permOwn: PERM.MESSAGE.REVOKE_OWN,
    label: '撤回消息',
  },
  'pin_message':       { priv: { group: 'message', bit: PRIV.MESSAGE.PIN },        perm: PERM.MESSAGE.PIN,       label: '置顶消息' },

  // 文件
  'view_file':         { priv: { group: 'file', bit: PRIV.FILE.VIEW },             perm: PERM.FILE.VIEW,         label: '查看文件' },
  'upload_file':       { priv: { group: 'file', bit: PRIV.FILE.UPLOAD },           perm: PERM.FILE.UPLOAD,       label: '上传文件' },
  // own/any 分离
  'delete_file':       {
    priv:    { group: 'file', bit: PRIV.FILE.DELETE_ANY },
    perm:    PERM.FILE.DELETE_ANY,
    privOwn: { group: 'file', bit: PRIV.FILE.DELETE_OWN },
    permOwn: PERM.FILE.DELETE_OWN,
    label: '删除文件',
  },

  // 成员
  'mute_member':       { priv: { group: 'member', bit: PRIV.MEMBER.MUTE },         perm: PERM.MESSAGE.MUTE_MEMBER,       label: '禁言成员' },
  'kick_member':       { priv: { group: 'member', bit: PRIV.MEMBER.KICK },         perm: PERM.MESSAGE.KICK_MEMBER,       label: '踢出成员' },
  'manage_user':       { priv: { group: 'member', bit: PRIV.MEMBER.MANAGE_USER },  perm: PERM.MANAGE.USER,       label: '管理域成员' },
  'manage_role':       { priv: { group: 'member', bit: PRIV.MEMBER.MANAGE_ROLE },  perm: PERM.MANAGE.ROLE,       label: '管理域角色' },
  'manage_perm':       { priv: { group: 'member', bit: PRIV.MEMBER.MANAGE_PERM },  perm: PERM.MANAGE.PERM,       label: '管理域权限' },

  // 域设置
  'edit_domain':       { priv: { group: 'domain', bit: PRIV.DOMAIN.EDIT },         perm: PERM.GENERAL.EDIT_DOMAIN,       label: '编辑域' },
  'manage_join': { priv: { group: 'domain', bit: PRIV.DOMAIN.MANAGE_JOIN }, perm: PERM.MANAGE.JOIN_APPL, label: '审批加入申请' },
  'transfer_domain': { priv: { group: 'domain', bit: PRIV.DOMAIN.TRANSFER }, perm: PERM.MANAGE.TRANSFER, label: '转让所有权' },
  'delete_domain': { priv: { group: 'domain', bit: PRIV.DOMAIN.DELETE }, perm: PERM.MANAGE.DELETE, label: '删除域' },
};

// TODO 批次3

// 区分 own/any
function isScopedDual(opKey) {
    const c = DUAL_CHECK[opKey];
    return !!(c && (c.privOwn || c.permOwn));
}

// 特权用户展示等级
const ADMIN_LEVEL = 99;

module.exports = {
    DUAL_CHECK, isScopedDual, ADMIN_LEVEL,
};

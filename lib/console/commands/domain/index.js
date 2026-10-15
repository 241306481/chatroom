'use strict';

// 聚合导出
const list = require('./list');
const edit = require('./edit');
const roles = require('./roles');

module.exports = {
    // 列表 / 详情
    list:     list.list,
    show:     list.show,
    members:  list.members,
    admins:   list.admins,
    bans:     list.bans,
    apps:     list.apps,

    // 增删改
    create:   edit.create,
    delete:   edit.delete,
    transfer: edit.transfer,
    announce: edit.announce,

    // 角色 / 权限
    roles:    roles.roles,
    perms:    roles.perms,
};
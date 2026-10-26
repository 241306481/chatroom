'use strict';
const list = require('./list');
const edit = require('./edit');
const roles = require('./roles');
module.exports = {
    list:     list.list,
    show:     list.show,
    members:  list.members,
    admins:   list.admins,
    bans:     list.bans,
    apps:     list.apps,
    create:   edit.create,
    delete:   edit.delete,
    transfer: edit.transfer,
    announce: edit.announce,
    roles:    roles.roles,
    perms:    roles.perms,
};

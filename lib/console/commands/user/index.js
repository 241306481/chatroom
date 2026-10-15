'use strict';

// 聚合导出
const list = require('./list');
const show = require('./show');
const profile = require('./profile');
const ban = require('./ban');
const social = require('./social');

module.exports = {
    // 列表与详情
    list:       list.list,
    online:     list.online,
    show:       show.show,
    find:       show.find,

    // 资料
    nick:       profile.nick,
    bio:        profile.bio,
    priv:       profile.priv,
    avatar:     profile.avatar,
    password:   profile.password,

    // 封禁 / 管理员
    ban:        ban.ban,
    unban:      ban.unban,
    admin:      ban.admin,
    deadmin:    ban.deadmin,

    // 社交 / 黑名单
    follow:     social.follow,
    unfollow:   social.unfollow,
    following:  social.following,
    followers:  social.followers,
    block:      social.block,
    unblock:    social.unblock,
    blocked:    social.blocked,
    blockedby:  social.blockedby,
};
'use strict';
const list = require('./list');
const show = require('./show');
const profile = require('./profile');
const ban = require('./ban');
const social = require('./social');
module.exports = {
    list:       list.list,
    online:     list.online,
    show:       show.show,
    find:       show.find,
    nick:       profile.nick,
    bio:        profile.bio,
    priv:       profile.priv,
    avatar:     profile.avatar,
    password:   profile.password,
    ban:        ban.ban,
    unban:      ban.unban,
    admin:      ban.admin,
    deadmin:    ban.deadmin,
    follow:     social.follow,
    unfollow:   social.unfollow,
    following:  social.following,
    followers:  social.followers,
    block:      social.block,
    unblock:    social.unblock,
    blocked:    social.blocked,
    blockedby:  social.blockedby,
};

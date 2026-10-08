'use strict';
const { discussMessagesPath } = require('./paths');
const { readJson, writeJsonAtomic } = require('./fs-utils');

function loadAllMessages(dn, disc) { return readJson(discussMessagesPath(dn, disc)) || []; }
function saveAllMessages(dn, disc, msgs) { writeJsonAtomic(discussMessagesPath(dn, disc), msgs); }

function appendMessage(dn, disc, msg) {
    const all = loadAllMessages(dn, disc);
    all.push(msg);
    saveAllMessages(dn, disc, all);
    return msg;
}

function findMessage(dn, disc, id) {
    return loadAllMessages(dn, disc).find(m => m.id === id) || null;
}

function updateMessage(dn, disc, id, patch) {
    const all = loadAllMessages(dn, disc);
    for (const m of all) if (m.id === id) Object.assign(m, patch);
    saveAllMessages(dn, disc, all);
}

function toggleReaction(dn, disc, msgId, uid, emoji) {
    const all = loadAllMessages(dn, disc);
    const m = all.find(x => x.id === msgId);
    if (!m) return null;
    if (!m.reactions || typeof m.reactions !== 'object') m.reactions = {};
    const key = 'e:' + emoji;
    const list = Array.isArray(m.reactions[key]) ? m.reactions[key] : [];
    const idx = list.indexOf(uid);
    let added;
    if (idx >= 0) {
        list.splice(idx, 1);
        added = false;
        if (list.length === 0) delete m.reactions[key];
        else m.reactions[key] = list;
    } else {
        list.push(uid);
        m.reactions[key] = list;
        added = true;
    }
    saveAllMessages(dn, disc, all);
    const count = m.reactions[key] ? m.reactions[key].length : 0;
    return { added, count };
}

module.exports = {
    loadAllMessages, saveAllMessages, appendMessage,
    findMessage, updateMessage, toggleReaction,
};
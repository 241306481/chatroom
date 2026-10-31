'use strict';
const fs = require('fs');
const {
    domainDiscussDir, discussDir,
    discussConfigPath,
    discussMessagesDir,
} = require('./paths');
const { readJsonState, quarantineCorrupt, writeJsonAtomic, sliceChars } = require('./fs-utils');
function loadDiscussion(dn, disc) {
    const p = discussConfigPath(dn, disc);
    const r = readJsonState(p);
    if (r.state === 'corrupt') {
        quarantineCorrupt(p, '讨论配置 ' + dn + '/' + disc);
        return {};
    }
    return r.value || {};
}
function saveDiscussion(dn, disc, cfg) { writeJsonAtomic(discussConfigPath(dn, disc), cfg); }
function listDiscussions(dn) {
    const dir = domainDiscussDir(dn);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(d => fs.existsSync(discussConfigPath(dn, d)))
        .sort((a, b) => {
            const pinA = !!loadDiscussion(dn, a).pinned;
            const pinB = !!loadDiscussion(dn, b).pinned;
            if (pinA !== pinB) return pinA ? -1 : 1;
            if (a === 'general') return -1;
            if (b === 'general') return 1;
            return a.localeCompare(b);
        });
}
function deleteDiscussion(dn, disc) {
    const dir = discussDir(dn, disc);
    try { require('./messages').closeAppendHandlesIn(discussMessagesDir(dn, disc)); }
    catch (e) {}
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
function deleteDiscussions(dn, ids) {
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) throw new Error('没有选择讨论');
    const selected = [];
    const seen = new Set();
    for (const raw of list) {
        const id = String(raw || '');
        if (!/^[a-z0-9_-]{1,32}$/.test(id) || seen.has(id)) {
            throw new Error('讨论选择无效');
        }
        if (id === 'general') throw new Error('不能删除 general');
        if (!loadDiscussion(dn, id).name) throw new Error('讨论不存在');
        seen.add(id);
        selected.push(id);
    }
    for (const id of selected) deleteDiscussion(dn, id);
    return selected.length;
}
function updateDiscussionTitle(dn, discId, title) {
    const cfg = loadDiscussion(dn, discId);
    if (!cfg.name) throw new Error('讨论不存在');
    cfg.title = sliceChars(title, 100);
    saveDiscussion(dn, discId, cfg);
    return cfg;
}
function setDiscussionsPinned(dn, ids, pinned) {
    const list = Array.isArray(ids) ? ids : [];
    if (!list.length) throw new Error('没有选择讨论');
    const selected = [];
    const seen = new Set();
    for (const raw of list) {
        const id = String(raw || '');
        if (!/^[a-z0-9_-]{1,32}$/.test(id) || seen.has(id)) {
            throw new Error('讨论选择无效');
        }
        if (!loadDiscussion(dn, id).name) throw new Error('讨论不存在');
        seen.add(id);
        selected.push(id);
    }
    for (const id of selected) {
        const cfg = loadDiscussion(dn, id);
        cfg.pinned = !!pinned;
        saveDiscussion(dn, id, cfg);
    }
    return selected.length;
}
function setDiscussionTitles(dn, updates) {
    const list = Array.isArray(updates) ? updates : [];
    if (!list.length) throw new Error('没有选择讨论');
    const prepared = [];
    const seen = new Set();
    for (const update of list) {
        const id = String(update && update.id || '');
        if (!/^[a-z0-9_-]{1,32}$/.test(id) || seen.has(id)) {
            throw new Error('讨论选择无效');
        }
        const cfg = loadDiscussion(dn, id);
        if (!cfg.name) throw new Error('讨论不存在');
        seen.add(id);
        prepared.push({ id, cfg, title: sliceChars(update.title, 100) });
    }
    for (const item of prepared) {
        item.cfg.title = item.title;
        saveDiscussion(dn, item.id, item.cfg);
    }
    return prepared.length;
}
function renameDiscussion(dn, oldId, newId) {
    if (oldId === newId) return oldId;
    if (!/^[a-z0-9_-]{1,32}$/.test(newId)) {
        throw new Error('讨论 ID 只能含小写字母、数字、下划线、短横线，长度 1-32');
    }
    const oldDir = discussDir(dn, oldId);
    const newDir = discussDir(dn, newId);
    if (!fs.existsSync(oldDir)) throw new Error('讨论不存在');
    if (fs.existsSync(newDir)) throw new Error('讨论 ID 已存在');
    fs.renameSync(oldDir, newDir);
    const cfg = loadDiscussion(dn, newId);
    cfg.name = newId;
    saveDiscussion(dn, newId, cfg);
    return newId;
}
module.exports = {
    loadDiscussion, saveDiscussion, listDiscussions, deleteDiscussion,
    deleteDiscussions, updateDiscussionTitle, setDiscussionsPinned, setDiscussionTitles,
    renameDiscussion,
};

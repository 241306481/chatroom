'use strict';
const fs = require('fs');
const {
    domainDiscussDir, discussDir,
    discussConfigPath,
} = require('./paths');
const { readJsonState, quarantineCorrupt, writeJsonAtomic, sliceChars } = require('./fs-utils');

// 讨论配置损坏同样不能默默当成「不存在」—— 否则下一次 saveDiscussion
// （改标题、rename）就会用残缺对象覆盖标题与元数据。保留现场 + 记日志。
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
            if (a === 'general') return -1;
            if (b === 'general') return 1;
            return a.localeCompare(b);
        });
}

function deleteDiscussion(dn, disc) {
    const dir = discussDir(dn, disc);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function updateDiscussionTitle(dn, discId, title) {
    const cfg = loadDiscussion(dn, discId);
    if (!cfg.name) throw new Error('讨论不存在');
    cfg.title = sliceChars(title, 100);
    saveDiscussion(dn, discId, cfg);
    return cfg;
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
    updateDiscussionTitle, renameDiscussion,
};
'use strict';
const fs = require('fs');
const path = require('path');
const { userDir } = require('./paths');

const MAX_RECORDS = 10;

function ipsPath(uid) {
    return path.join(userDir(uid), 'ips.json');
}

function load(uid) {
    const p = ipsPath(uid);
    if (!fs.existsSync(p)) return [];
    try {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        return Array.isArray(d) ? d : [];
    } catch (e) { return []; }
}

function save(uid, list) {
    const p = ipsPath(uid);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(list, null, 2), 'utf8');
}

// 记录一次登录 IP，同 IP 去重后按时间倒序，保留最近 MAX_RECORDS 条
function record(uid, ip) {
    if (!uid || ip === undefined || ip === null) return;
    ip = String(ip).trim();
    if (!ip || ip === '-') return;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    let list = load(uid).filter((r) => r && r.ip !== ip);
    list.unshift({ ip, at: now });
    if (list.length > MAX_RECORDS) list = list.slice(0, MAX_RECORDS);
    save(uid, list);
}

module.exports = { load, record };
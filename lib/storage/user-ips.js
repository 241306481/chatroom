'use strict';
const fs = require('fs');
const path = require('path');
const { userDir } = require('./paths');
const { writeJsonAtomic } = require('./fs-utils');
const { normalizeIp } = require('../http-utils');

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
    } catch (e) {
        // 解析失败意味着这个用户的登录 IP 审计记录丢失，必须留痕
        try {
            require('../logger').error('user ips.json 解析失败:', uid, e.message);
        } catch (e2) {}
        return [];
    }
}

function save(uid, list) {
    writeJsonAtomic(ipsPath(uid), list);
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_RE = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

function isRecordableIp(ip) {
    if (IPV4_RE.test(ip)) return ip.split('.').every((s) => parseInt(s, 10) <= 255);
    if (IPV6_RE.test(ip)) return true;
    return false;
}

// 记录一次登录 IP，同 IP 去重后按时间倒序，保留最近 MAX_RECORDS 条
function record(uid, ip) {
    if (!uid || ip === undefined || ip === null) return;
    // 归一化：去掉 ::ffff: 前缀与 ::1（与 http-utils.getClientIp 一致）
    ip = String(ip).trim();
    if (!ip || ip === '-') return;
    ip = normalizeIp(ip);
    if (!isRecordableIp(ip)) return;
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    let list = load(uid).filter((r) => r && r.ip !== ip);
    list.unshift({ ip, at: now });
    if (list.length > MAX_RECORDS) list = list.slice(0, MAX_RECORDS);
    save(uid, list);
}

module.exports = { load, record };
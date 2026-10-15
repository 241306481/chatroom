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

// 原子写：非原子写在崩溃时会留下半截 JSON，导致审计记录静默清空
function save(uid, list) {
    writeJsonAtomic(ipsPath(uid), list);
}

// 允许记录的地址形态：IPv4 与 IPv6 都接受。
// ip-bans 的 matchRule 只处理 4 段 IPv4，对 IPv6 会返回 false（分段数不匹配），
// 所以不会误封——但审计记录必须完整，否则管理页会显示「没有任何数据」。
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
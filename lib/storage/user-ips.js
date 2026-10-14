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

// 可封禁的地址形态：与 storage/ip-bans.js 的 validateRule / matchRule 对齐，
// 那两处都要求恰好 4 段十进制。记录一个 ip-bans 永远匹配不上的地址，
// 只会在管理页显示一条管理员无法复制使用的死地址，误导溯源。
const BANABLE_IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

// 记录一次登录 IP，同 IP 去重后按时间倒序，保留最近 MAX_RECORDS 条
function record(uid, ip) {
    if (!uid || ip === undefined || ip === null) return;
    // 归一化：去掉 ::ffff: 前缀与 ::1（与 http-utils.getClientIp 一致）
    ip = String(ip).trim();
    if (!ip || ip === '-') return;
    ip = normalizeIp(ip);
    if (!BANABLE_IP_RE.test(ip)) return;   // IPv6 / 非法格式不可封禁，不记录
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    let list = load(uid).filter((r) => r && r.ip !== ip);
    list.unshift({ ip, at: now });
    if (list.length > MAX_RECORDS) list = list.slice(0, MAX_RECORDS);
    save(uid, list);
}

module.exports = { load, record };
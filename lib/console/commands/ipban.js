'use strict';
const os = require('os');
const ipBans = require('../../storage/ip-bans');
const userIps = require('../../storage/user-ips');
const storage = require('../../storage');
const { C, padR, fmtIso } = require('../ui');
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const clip = (s, n) => storage.sliceChars(s == null ? '' : s, n);
function usage(sub) {
    console.log(`${C.red}用法：ipban ${sub}${C.reset}`);
}
function list() {
    const rules = ipBans.listAll();
    if (!rules.length) { console.log(`${C.gray}（无封禁规则）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('规则', 20) + padR('原因', 26) + padR('操作人', 12)
        + padR('到期', 22) + '创建时间' + C.reset);
    console.log(`${C.gray}${'─'.repeat(96)}${C.reset}`);
    const { isUntilActive } = require('../../until');
    for (const r of rules) {
        const until = !r.until ? `${C.yellow}永久${C.reset}`
            : isUntilActive(r.until) ? r.until
                : `${C.red}已过期${C.reset}`;
        console.log(
            padR(r.rule, 20) +
            padR(clip(r.reason || '—', 24), 26) +
            padR(clip(r.by || '—', 10), 12) +
            padR(until, 22) +
            fmtIso(r.at)
        );
    }
    console.log(`${C.gray}共 ${rules.length} 条规则${C.reset}`);
}
function add(args) {
    const [rule, ...rest] = args;
    if (!rule) { usage('add <rule> [until] [reason...]'); return; }
    let until = '';
    let reason = rest;
    if (rest.length && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rest[0])) {
        until = rest[0];
        reason = rest.slice(1);
    }
    try {
        ipBans.addBan(rule, { until, reason: reason.join(' ') });
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
        console.log(`${C.gray}  规则写法：4 段点分，每段可用数字、* 或 a-b 区间${C.reset}`);
        console.log(`${C.gray}  例：1.2.3.4 / 10.0.0.* / 10.0.0.1-99 / *${C.reset}`);
        return;
    }
    const rec = ipBans.listAll().find(x => x.rule === rule) || {};
    console.log(`${C.green}✔ 已封禁 ${rule}${C.reset}  ${rec.until || '（永久）'}`);
    console.log(`${C.gray}  该规则只影响新请求与新建的 WS 连接；`
        + `已在运行的实例需要另行 kick 才会立刻断开${C.reset}`);
}
function remove(args) {
    const rule = args[0];
    if (!rule) { usage('remove <rule>'); return; }
    if (!ipBans.listAll().some(r => r.rule === rule)) {
        console.log(`${C.red}规则不存在：${rule}${C.reset}`);
        return;
    }
    ipBans.removeByRule(rule);
    console.log(`${C.green}✔ 已移除 ${rule}${C.reset}`);
}
function check(args) {
    const ip = args[0];
    if (!ip) { usage('check <ip>'); return; }
    const hit = ipBans.isBanned(ip);
    if (hit) {
        console.log(`${ip} → ${C.red}命中规则 ${hit.rule}${C.reset}`
            + `  原因：${hit.reason || '—'}  到期：${hit.until || '永久'}`);
    } else {
        console.log(`${ip} → ${C.green}未被封禁${C.reset}`);
    }
    const local = [];
    for (const n of Object.keys(os.networkInterfaces())) {
        for (const i of os.networkInterfaces()[n]) {
            if (i.family === 'IPv4') local.push(i.address);
        }
    }
    console.log(`${C.gray}  本机 IPv4：${local.join(', ') || '无'}${C.reset}`);
}
function users() {
    const rows = [];
    for (const u of storage.listRealUsers()) {
        const list = userIps.load(u.id) || [];
        if (list.length) rows.push([u, list]);
    }
    if (!rows.length) { console.log(`${C.gray}（暂无 IP 记录）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('UID', 8) + padR('昵称', 22) + padR('最近 IP', 18)
        + padR('记录数', 8) + '最后出现' + C.reset);
    console.log(`${C.gray}${'─'.repeat(78)}${C.reset}`);
    for (const [u, list] of rows) {
        const last = list[0] || {};
        console.log(
            padR(u.id, 8) +
            padR(clip(u.nickname || '?', 20), 22) +
            padR(last.ip || '—', 18) +
            padR(String(list.length), 8) +
            fmtIso(last.at)
        );
    }
}
function user(args) {
    const uid = args[0];
    if (!uid) { usage('user <uid>'); return; }
    const list = userIps.load(uid) || [];
    if (!list.length) { console.log(`${C.gray}（该用户暂无 IP 记录）${C.reset}`); return; }
    console.log(`${C.bold}用户 ${uid} 的 IP 记录（${list.length} 条，按时间倒序）${C.reset}`);
    console.log(`${C.gray}${'─'.repeat(48)}${C.reset}`);
    for (const r of list) {
        console.log('  ' + padR(r.ip, 22) + fmtIso(r.at));
    }
}
module.exports = { list, add, remove, check, users, user };

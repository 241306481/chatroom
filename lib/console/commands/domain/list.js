'use strict';
const storage = require('../../../storage');
const { C, padR, fmtIso } = require('../../ui');

// 列出所有域
function list() {
    const names = storage.listAllDomains();
    if (!names.length) { console.log(`${C.gray}（无域）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('名称', 20) + padR('显示名', 20)
        + padR('成员', 6) + padR('策略', 10) + '所有者' + C.reset);
    console.log(`${C.gray}${'─'.repeat(80)}${C.reset}`);
    for (const dn of names) {
        const d = storage.loadDomain(dn);
        const members = Object.keys(d.members || {}).length;
        const owner = d.owner_id
            ? (storage.loadUser(d.owner_id).nickname || d.owner_id)
            : '—';
        console.log(
            padR(dn, 20) +
            padR(d.display_name || dn, 20) +
            padR(members, 6) +
            padR(d.join_policy || 'open', 10) +
            owner
        );
    }
    console.log(`${C.gray}共 ${names.length} 个域${C.reset}`);
}

// 域详情
function show(args) {
    const name = args[0];
    if (!name) { console.log(`${C.red}用法：domain show <name>${C.reset}`); return; }
    const d = storage.loadDomain(name);
    if (!d.name) { console.log(`${C.red}域 ${name} 不存在${C.reset}`); return; }
    console.log(`${C.bold}域详情 ${d.name}${C.reset}`);
    console.log(`  显示名：    ${d.display_name || d.name}`);
    const owner = d.owner_id
        ? `${storage.loadUser(d.owner_id).nickname || '?'} (${d.owner_id})`
        : '—';
    console.log(`  所有者：    ${owner}`);
    console.log(`  加入策略：  ${d.join_policy || 'open'}`);
    console.log(`  成员数：    ${Object.keys(d.members || {}).length}`);
    console.log(`  封禁数：    ${Object.keys(d.bans || {}).length}`);
    console.log(`  创建时间：  ${fmtIso(d.created_at)}`);
    console.log(`  公告：      ${d.announcement || '（空）'}`);
    console.log(`  讨论：      ${storage.listDiscussions(name).join(', ') || '（无）'}`);
    const fileCount = storage.listDomainFiles(name).length;
    if (fileCount) console.log(`  文件数：    ${fileCount}`);
    const apps = (d.join_applications || []).length;
    if (apps) console.log(`  ${C.yellow}待审批：    ${apps} 条${C.reset}`);
}

// 列出成员
function members(args) {
    const name = args[0];
    if (!name) { console.log(`${C.red}用法：domain members <name>${C.reset}`); return; }
    const d = storage.loadDomain(name);
    if (!d.name) { console.log(`${C.red}域 ${name} 不存在${C.reset}`); return; }
    const entries = Object.entries(d.members || {});
    if (!entries.length) { console.log(`${C.gray}（无成员）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('UID', 6) + padR('昵称', 20)
        + padR('角色', 14) + padR('等级', 6) + padR('经验', 8) + '加入时间' + C.reset);
    console.log(`${C.gray}${'─'.repeat(82)}${C.reset}`);
    for (const [uid, m] of entries) {
        const u = storage.loadUser(uid);
        const isOwner = d.owner_id === uid;
        const role = isOwner ? '所有者' : (m.role || 'default');
        const roleColored = isOwner
            ? `${C.yellow}所有者${C.reset}`
            : (m.role === 'root' ? `${C.yellow}管理员${C.reset}` : role);
        console.log(
            padR(uid, 6) +
            padR(u.nickname || '?', 20) +
            padR(roleColored, 14) +
            padR(m.level || 0, 6) +
            padR(m.exp || 0, 8) +
            fmtIso(m.joined_at)
        );
    }
}

// 列出管理员
function admins(args) {
    const name = args[0];
    if (!name) { console.log(`${C.red}用法：domain admins <name>${C.reset}`); return; }
    const d = storage.loadDomain(name);
    if (!d.name) { console.log(`${C.red}域 ${name} 不存在${C.reset}`); return; }
    const list = Object.entries(d.members || {})
        .filter(([uid, m]) => m.role === 'root' || d.owner_id === uid);
    if (!list.length) { console.log(`${C.gray}（无管理员）${C.reset}`); return; }
    for (const [uid, m] of list) {
        const u = storage.loadUser(uid);
        const tag = d.owner_id === uid ? `${C.yellow}所有者${C.reset}` : '管理员  ';
        console.log(`  ${C.cyan}${padR(uid, 6)}${C.reset}${padR(u.nickname || '?', 20)}${tag}`);
    }
}

// 列出封禁
function bans(args) {
    const name = args[0];
    if (!name) { console.log(`${C.red}用法：domain bans <name>${C.reset}`); return; }
    const d = storage.loadDomain(name);
    if (!d.name) { console.log(`${C.red}域 ${name} 不存在${C.reset}`); return; }
    const entries = Object.entries(d.bans || {});
    if (!entries.length) { console.log(`${C.gray}（无封禁）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('UID', 6) + padR('昵称', 20)
        + padR('原因', 24) + padR('到期', 22) + '操作者' + C.reset);
    console.log(`${C.gray}${'─'.repeat(90)}${C.reset}`);
    for (const [uid, b] of entries) {
        const u = storage.loadUser(uid);
        console.log(
            padR(uid, 6) +
            padR(u.nickname || '?', 20) +
            padR(storage.sliceChars(b.reason || '', 22), 24) +
            padR(b.until || '永久', 22) +
            (b.by || '—')
        );
    }
}

// 列出加入申请
function apps(args) {
    const name = args[0];
    if (!name) { console.log(`${C.red}用法：domain apps <name>${C.reset}`); return; }
    const d = storage.loadDomain(name);
    if (!d.name) { console.log(`${C.red}域 ${name} 不存在${C.reset}`); return; }
    const list = d.join_applications || [];
    if (!list.length) { console.log(`${C.gray}（无待审批）${C.reset}`); return; }
    for (const a of list) {
        const u = storage.loadUser(a.uid);
        console.log(`  ${C.cyan}${padR(a.uid, 6)}${C.reset}${padR(u.nickname || a.nickname || '?', 20)}${C.gray}${fmtIso(a.created_at)}${C.reset}`);
        if (a.message) console.log(`    ${storage.sliceChars(a.message, 100)}`);
    }
}

module.exports = { list, show, members, admins, bans, apps };
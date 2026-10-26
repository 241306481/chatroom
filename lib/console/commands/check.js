'use strict';
const fs = require('fs');
const path = require('path');
const storage = require('../../storage');
const { C } = require('../ui');
const ROOT = storage.ROOT;
let pass = 0, warn = 0, bad = 0;
const rows = [];
function ok(name, detail) { pass++; rows.push(['ok', name, detail]); }
function warning(name, detail) { warn++; rows.push(['warn', name, detail]); }
function fail(name, detail) { bad++; rows.push(['bad', name, detail]); }
const ITEMS = [];
ITEMS.user = {
    title: '用户',
    run() {
        const all = storage.listAllUsers();
        const real = storage.listRealUsers();
        ok('用户总数', `${all.length}（含系统 ${all.length - real.length}）`);
        if (!storage.loadUser(storage.SYSTEM_UID).id) fail('系统账户', '缺失');
        const broken = real.filter((u) => !u.id);
        if (broken.length) fail('用户记录', `${broken.length} 条损坏`);
        const dup = new Set();
        let dupNick = 0;
        for (const u of real) {
            const k = String(u.nickname || '').toLowerCase();
            if (dup.has(k)) dupNick++;
            dup.add(k);
        }
        if (dupNick) warning('昵称重复', `${dupNick} 组`);
        const noAvatar = real.filter((u) => u.avatar_ext && !fs.existsSync(
            path.join(storage.USER_DIR, u.id, 'avatar.' + u.avatar_ext))).length;
        if (noAvatar) warning('头像文件缺失', `${noAvatar} 人`);
    },
};
ITEMS.domain = {
    title: '域',
    run() {
        const names = storage.listAllDomains();
        ok('域数量', String(names.length));
        if (!storage.domainExists('system')) fail('system 域', '缺失');
        let broken = 0, orphanMember = 0;
        for (const dn of names) {
            const d = storage.loadDomain(dn);
            if (!d.name || typeof d.members !== 'object') { broken++; continue; }
            for (const uid of Object.keys(d.members || {})) {
                if (!storage.loadUser(uid).id) orphanMember++;
            }
        }
        if (broken) fail('域配置', `${broken} 个损坏`);
        if (orphanMember) warning('成员表中已不存在的用户', `${orphanMember} 条`);
    },
};
ITEMS.discuss = {
    title: '讨论',
    run() {
        let total = 0, broken = 0, empty = 0;
        for (const dn of storage.listAllDomains()) {
            for (const disc of storage.listDiscussions(dn)) {
                total++;
                const d = storage.loadDiscussion(dn, disc);
                if (!d.name) { broken++; continue; }
                if (!storage.loadAllMessages(dn, disc).length) empty++;
            }
        }
        ok('讨论总数', String(total));
        if (broken) fail('讨论配置', `${broken} 个损坏`);
        if (empty) warning('无消息的讨论', `${empty} 个`);
    },
};
ITEMS.dm = {
    title: '私信',
    run() {
        let convs = 0, broken = 0, missingDir = 0;
        for (const u of storage.listRealUsers()) {
            const list = storage.listConversations(u.id);
            if (!Array.isArray(list)) { broken++; continue; }
            for (const c of list) {
                convs++;
                const target = c.target || c.with || c.id;
                if (target && !storage.loadUser(target).id) missingDir++;
            }
        }
        ok('会话条目', String(convs));
        if (broken) fail('会话索引', `${broken} 个损坏`);
        if (missingDir) warning('会话指向已删除的用户', `${missingDir} 条`);
    },
};
ITEMS.file = {
    title: '文件',
    run() {
        let idx = 0, lost = 0;
        for (const u of storage.listRealUsers()) {
            const list = storage.listUserFiles(u.id) || [];
            for (const f of list) {
                idx++;
                if (!storage.getUserFileContent(u.id, f.id)) lost++;
            }
        }
        for (const dn of storage.listAllDomains()) {
            const list = storage.listDomainFiles(dn) || [];
            for (const f of list) {
                idx++;
                if (!storage.getDomainFileContent(dn, f.id)) lost++;
            }
        }
        ok('索引中的文件', String(idx));
        if (lost) fail('索引指向的文件已丢失', `${lost} 个（索引与磁盘不一致）`);
    },
};
ITEMS.avatar = {
    title: '头像',
    run() {
        const { avatarExtOnDisk } = require('../../avatar-view');
        const EXTS = new Set(['png', 'jpg', 'gif', 'webp']);
        let withField = 0, badExt = 0, mismatch = 0, orphan = 0, dangling = 0;
        for (const u of storage.listAllUsers()) {
            const dir = path.join(storage.USER_DIR, u.id);
            let hasFile = false;
            try { hasFile = fs.readdirSync(dir).some((f) => /^avatar\./.test(f)); } catch (e) {}
            const onDisk = avatarExtOnDisk(u);
            const field = u.avatar_ext ? String(u.avatar_ext).toLowerCase() : '';
            if (field && !EXTS.has(field)) { badExt++; continue; }
            if (field) withField++;
            if (field && !onDisk) dangling++;
            else if (field && field !== onDisk) mismatch++;
            if (!field && hasFile) orphan++;
        }
        ok('登记了头像的用户', String(withField));
        if (badExt) fail('avatar_ext 取值非法', `${badExt} 人`);
        if (dangling) fail('字段指向已丢失的文件', `${dangling} 人（页面会显示破图）`);
        if (mismatch) fail('字段与文件格式不一致', `${mismatch} 人`);
        if (orphan) warning('有文件但未登记', `${orphan} 人`);
    },
};
ITEMS.perm = {
    title: '权限',
    run() {
        const { loadSystemRoles } = require('../../storage/system-roles');
        const roles = storage.loadSystemRoles() || {};
        ok('系统角色', Object.keys(roles).join(', ') || '(空)');
        const bad = [];
        for (const dn of storage.listAllDomains()) {
            const d = storage.loadDomain(dn);
            for (const [uid, m] of Object.entries(d.members || {})) {
                const role = m.role || 'default';
                const names = Object.keys(d.roles || {});
                if (role !== 'default' && names.length && !names.includes(role)) bad.push(`${dn}/${uid}=${role}`);
            }
        }
        if (bad.length) fail('成员引用了不存在的域角色', bad.slice(0, 5).join(', '));
    },
};
ITEMS.ip = {
    title: 'IP 封禁',
    run() {
        const ipBans = require('../../storage/ip-bans');
        const { isValidUntil } = require('../../until');
        const rules = ipBans.listAll();
        ok('规则数', String(rules.length));
        const badRule = [];
        const badUntil = [];
        for (const r of rules) {
            try { ipBans.validateRule(r.rule); } catch (e) { badRule.push(r.rule); }
            if (!isValidUntil(r.until)) badUntil.push(r.rule);
        }
        if (badRule.length) fail('规则格式非法', badRule.join(', '));
        if (badUntil.length) fail('解封时间非法', badUntil.join(', '));
    },
};
ITEMS.ban = {
    title: '封禁',
    run() {
        const bans = require('../../auth/bans');
        const bad = bans.auditInvalidBans();
        const n = bad.users.length + bad.domains.length + bad.mutes.length + bad.ipRules.length;
        ok('封禁记录', `全局 ${bad.users.length + bad.domains.length}，禁言 ${bad.mutes.length}`);
        if (n) fail('解禁时间非法', `${n} 条（运行时按永久处理，用 ban repair 修复）`);
    },
};
ITEMS.json = {
    title: 'JSON 完整性',
    run() {
        const broken = [];
        let n = 0;
        const scan = (dir, label) => {
            let names;
            try { names = fs.readdirSync(dir); } catch (e) { return; }
            for (const name of names) {
                const f = path.join(dir, name, 'config.json');
                if (!fs.existsSync(f)) continue;
                n++;
                try {
                    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
                    if (!v || typeof v !== 'object') broken.push(label + '/' + name);
                } catch (e) { broken.push(label + '/' + name); }
            }
        };
        scan(storage.DOMAIN_DIR, 'domains');
        scan(storage.USER_DIR, 'users');
        ok('config.json', `${n} 个`);
        if (broken.length) fail('解析失败', broken.slice(0, 5).join(', '));
    },
};
ITEMS.space = {
    title: '磁盘',
    run() {
        try {
            const st = fs.statfsSync(ROOT);
            const free = Math.floor(st.bavail * st.bsize / 1024 / 1024);
            ok('数据盘剩余', `${free} MB`);
            if (free < 50) fail('空间不足', '低于 50 MB，文件写入会很快失败');
            else if (free < 500) warning('空间偏紧', `${free} MB`);
        } catch (e) {
            warning('磁盘剩余', '无法读取');
        }
    },
};
ITEMS.session = {
    title: '会话',
    run() {
        const sessions = require('../../auth/sessions');
        const list = sessions.listSessions();
        ok('在线会话', String(list.length));
    },
};
function flush() {
    const mark = { ok: `${C.green}✔${C.reset}`, warn: `${C.yellow}!${C.reset}`, bad: `${C.red}✘${C.reset}` };
    for (const [level, name, detail] of rows) {
        console.log(`  ${mark[level]} ${name}${detail ? `  ${C.gray}${detail}${C.reset}` : ''}`);
    }
    console.log(`  ${C.gray}${'-'.repeat(52)}${C.reset}`);
    console.log(`  通过 ${C.green}${pass}${C.reset}` +
        (warn ? `，警告 ${C.yellow}${warn}${C.reset}` : '') +
        (bad ? `，失败 ${C.red}${bad}${C.reset}` : ''));
    rows.length = 0; pass = 0; warn = 0; bad = 0;
}
function run(names) {
    const list = names && names.length ? names : Object.keys(ITEMS);
    const unknown = list.filter((n) => !ITEMS[n]);
    if (unknown.length) {
        console.log(`${C.red}未知检查项：${unknown.join(', ')}${C.reset}`);
        console.log(`${C.gray}  可用：${Object.keys(ITEMS).join(' / ')}${C.reset}`);
        return;
    }
    for (const n of list) {
        const it = ITEMS[n];
        console.log(`${C.bold}${it.title}${C.reset}`);
        try {
            it.run();
        } catch (e) {
            fail('检查自身出错', e.message);
        }
        flush();
    }
}
function repairAvatar() {
    const { avatarExtOnDisk } = require('../../avatar-view');
    const avatar = require('../../storage/avatar');
    let fixed = 0;
    for (const u of storage.listAllUsers()) {
        const onDisk = avatarExtOnDisk(u);
        const field = u.avatar_ext ? String(u.avatar_ext).toLowerCase() : '';
        if (field === onDisk) continue;
        if (!onDisk) avatar.clear(u.id);
        const rec = storage.loadUser(u.id);
        if (onDisk) rec.avatar_ext = onDisk; else delete rec.avatar_ext;
        storage.saveUser(u.id, rec);
        fixed++;
    }
    if (!fixed) { console.log(`${C.green}✔ 头像记录已一致，无需修复${C.reset}`); return; }
    console.log(`${C.green}✔ 已修复 ${fixed} 条头像记录${C.reset}（以磁盘上的文件为准）`);
}
function usage() {
    console.log(`${C.red}用法：check [功能] | check help | check avatar repair${C.reset}`);
    console.log(`${C.gray}  功能：${Object.keys(ITEMS).join(' / ')}${C.reset}`);
}
for (const key of Object.keys(ITEMS)) {
    module.exports[key] = () => run([key]);
}
module.exports.__default = () => run();
module.exports.run = run;
module.exports.ITEMS = ITEMS;
module.exports.usage = usage;
module.exports.help = usage;
module.exports.all = () => run();
module.exports.repairAvatar = repairAvatar;
module.exports.avatar = (args) => {
    if (String((args && args[0]) || '').toLowerCase() === 'repair') { repairAvatar(); return; }
    run(['avatar']);
};

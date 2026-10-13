'use strict';
const storage = require('../../storage');
const { C, padR, fmtIso, shortId } = require('../ui');

// ============================================================
// 列表 / 详情
// ============================================================
function list(args) {
    const dn = args[0];
    if (!dn) { console.log(`${C.red}用法：domain discuss list <domain>${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    const discs = storage.listDiscussions(dn);
    if (!discs.length) { console.log(`${C.gray}（无讨论）${C.reset}`); return; }
    console.log(`${C.bold}`
        + padR('ID', 20) + padR('标题', 24)
        + padR('消息数', 8) + '创建时间' + C.reset);
    console.log(`${C.gray}${'─'.repeat(70)}${C.reset}`);
    for (const id of discs) {
        const cfg = storage.loadDiscussion(dn, id);
        const cnt = storage.loadAllMessages(dn, id).filter(m => !m.deleted).length;
        console.log(
            padR('#' + id, 20) +
            padR(storage.sliceChars(cfg.title || '（无标题）', 22), 24) +
            padR(cnt, 8) +
            fmtIso(cfg.created_at)
        );
    }
    console.log(`${C.gray}共 ${discs.length} 个讨论${C.reset}`);
}

function show(args) {
    const [dn, disc] = args;
    if (!dn || !disc) { console.log(`${C.red}用法：domain discuss show <domain> <disc>${C.reset}`); return; }
    const cfg = storage.loadDiscussion(dn, disc);
    if (!cfg.name) { console.log(`${C.red}讨论不存在${C.reset}`); return; }
    const all = storage.loadAllMessages(dn, disc);
    const alive = all.filter(m => !m.deleted);
    const pinned = alive.filter(m => m.pinned);
    console.log(`${C.bold}讨论详情 ${dn}/${disc}${C.reset}`);
    console.log(`  标题：      ${cfg.title || '（无标题）'}`);
    console.log(`  创建时间：  ${fmtIso(cfg.created_at)}`);
    console.log(`  消息总数：  ${all.length}（有效 ${alive.length}，已删 ${all.length - alive.length}）`);
    console.log(`  置顶数：    ${pinned.length}`);

    const recent = alive.slice(-5);
    if (recent.length) {
        console.log(`\n  ${C.bold}最近消息${C.reset}`);
        for (const m of recent) {
            const content = storage.sliceChars((m.content || '').replace(/\n/g, ' '), 60);
            console.log(`    ${C.gray}${fmtIso(m.created_at)}${C.reset}  ${C.cyan}${shortId(m.id, 8)}${C.reset} ${m.nickname || '?'}: ${content}`);
        }
    }
}

// ============================================================
// 增删改
// ============================================================
function create(args) {
    const [dn, disc, ...rest] = args;
    const title = rest.join(' ');
    if (!dn || !disc) { console.log(`${C.red}用法：domain discuss create <domain> <disc> [title]${C.reset}`); return; }
    const d = storage.loadDomain(dn);
    if (!d.name) { console.log(`${C.red}域 ${dn} 不存在${C.reset}`); return; }
    if (!/^[a-z0-9_-]{1,32}$/.test(disc)) {
        console.log(`${C.red}✘ 讨论 ID 只能含小写字母、数字、下划线、短横线（1-32 位）${C.reset}`); return;
    }
    if (storage.loadDiscussion(dn, disc).name) {
        console.log(`${C.red}✘ 讨论 ID 已存在${C.reset}`); return;
    }
    storage.saveDiscussion(dn, disc, {
        name: disc,
        title: storage.sliceChars(title, 100),
        created_at: storage.nowIso(),
        pinned_messages: [],
    });
    console.log(`${C.green}✔ 已创建讨论 #${disc}${title ? '（' + title + '）' : ''}${C.reset}`);
}

function rename(args) {
    const [dn, oldId, newId] = args;
    if (!dn || !oldId || !newId) {
        console.log(`${C.red}用法：domain discuss rename <domain> <oldId> <newId>${C.reset}`); return;
    }
    if (oldId === 'general') { console.log(`${C.red}✘ general 不能重命名${C.reset}`); return; }
    try {
        const finalId = storage.renameDiscussion(dn, oldId, newId);
        console.log(`${C.green}✔ 已重命名 ${oldId} → ${finalId}${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

function title(args) {
    const [dn, disc, ...rest] = args;
    const t = rest.join(' ');
    if (!dn || !disc) { console.log(`${C.red}用法：domain discuss title <domain> <disc> <title>${C.reset}`); return; }
    try {
        storage.updateDiscussionTitle(dn, disc, t);
        console.log(`${C.green}✔ 已设置 #${disc} 的标题为「${t || '（空）'}」${C.reset}`);
    } catch (e) {
        console.log(`${C.red}✘ ${e.message}${C.reset}`);
    }
}

function clear(args) {
    const [dn, disc] = args;
    if (!dn || !disc) { console.log(`${C.red}用法：domain discuss clear <domain> <disc>${C.reset}`); return; }
    const cfg = storage.loadDiscussion(dn, disc);
    if (!cfg.name) { console.log(`${C.red}讨论不存在${C.reset}`); return; }
    const all = storage.loadAllMessages(dn, disc);
    const alive = all.filter(m => !m.deleted).length;
    storage.saveAllMessages(dn, disc, []);
    console.log(`${C.green}✔ 已清空 #${disc}（共 ${alive} 条有效消息）${C.reset}`);
}

function del(args) {
    const [dn, disc] = args;
    if (!dn || !disc) { console.log(`${C.red}用法：domain discuss delete <domain> <disc>${C.reset}`); return; }
    if (disc === 'general') { console.log(`${C.red}✘ general 不能删除${C.reset}`); return; }
    const cfg = storage.loadDiscussion(dn, disc);
    if (!cfg.name) { console.log(`${C.red}讨论不存在${C.reset}`); return; }
    storage.deleteDiscussion(dn, disc);
    console.log(`${C.green}✔ 已删除讨论 #${disc}${C.reset}`);
}

// ============================================================
// 消息操作
// ============================================================
function pin(args) {
    const [dn, disc, msgId] = args;
    if (!dn || !disc || !msgId) {
        console.log(`${C.red}用法：domain discuss pin <domain> <disc> <msgId>${C.reset}`); return;
    }
    const m = storage.findMessage(dn, disc, msgId);
    if (!m) { console.log(`${C.red}✘ 消息不存在${C.reset}`); return; }
    const patch = { pinned: true };
    if (!m.ever_pinned) patch.ever_pinned = true;
    storage.updateMessage(dn, disc, msgId, patch);
    console.log(`${C.green}✔ 已置顶 ${shortId(msgId, 8)}${C.reset}`);
}

function unpin(args) {
    const [dn, disc, msgId] = args;
    if (!dn || !disc || !msgId) {
        console.log(`${C.red}用法：domain discuss unpin <domain> <disc> <msgId>${C.reset}`); return;
    }
    const m = storage.findMessage(dn, disc, msgId);
    if (!m) { console.log(`${C.red}✘ 消息不存在${C.reset}`); return; }
    storage.updateMessage(dn, disc, msgId, { pinned: false });
    console.log(`${C.green}✔ 已取消置顶 ${shortId(msgId, 8)}${C.reset}`);
}

function rm(args) {
    const [dn, disc, msgId] = args;
    if (!dn || !disc || !msgId) {
        console.log(`${C.red}用法：domain discuss rm <domain> <disc> <msgId>${C.reset}`); return;
    }
    const m = storage.findMessage(dn, disc, msgId);
    if (!m) { console.log(`${C.red}✘ 消息不存在${C.reset}`); return; }
    storage.updateMessage(dn, disc, msgId, { deleted: true });
    console.log(`${C.green}✔ 已删除消息 ${shortId(msgId, 8)}${C.reset}`);
}

module.exports = {
    list, show, create, rename, title, clear,
    delete: del, pin, unpin, rm,
};
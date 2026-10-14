'use strict';
const storage = require('../../../storage');
const { validateNickname } = require('../../../storage/nickname-rules');
const { C, resolveUser, userTag } = require('../../ui');

// ============================================================
// user nick —— 修改昵称
// ============================================================
function nick(args) {
    const uid = args[0];
    const rawNick = args.slice(1).join(' ').trim();
    if (!uid || !rawNick) { console.log(`${C.red}用法：user nick <uid> <newnick>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }

    // 控制台此前绕过了昵称规则（保留名、长度、数字开头、控制字符）
    let newNick;
    try { newNick = validateNickname(rawNick); }
    catch (e) { console.log(`${C.red}✘ ${e.message}${C.reset}`); return; }

    const existing = storage.findUserByNickname(newNick);
    if (existing && existing.id !== uid) {
        console.log(`${C.red}✘ 昵称「${newNick}」已被 ${userTag(existing)} 占用${C.reset}`);
        return;
    }
    const old = u.nickname;
    u.nickname = newNick;
    storage.saveUser(uid, u);
    // 必须同步昵称索引：login() 依赖 findUserByNickname，
    // 漏掉这步会让该用户既不能用新昵称登录、也不能用旧昵称（索引仍指向他）
    if (old !== newNick) storage.indexRename(old, newNick, uid);
    console.log(`${C.green}✔ ${userTag({ id: uid, nickname: old })} → ${C.reset}${C.cyan}${newNick}${C.reset}`);
}

// ============================================================
// user bio —— 修改简介
// ============================================================
function bio(args) {
    const uid = args[0];
    const text = args.slice(1).join(' ');
    if (!uid) { console.log(`${C.red}用法：user bio <uid> <text>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    u.bio = text || '';
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ 已更新 ${userTag(u)} 的简介${C.reset}`);
}

// ============================================================
// user priv —— 查看权限组（权限只能在 Web UI 修改）
// ============================================================
function priv(args) {
    const uid = args[0];
    if (!uid) { console.log(`${C.red}用法：user priv <uid>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }

    console.log(`  当前权限组：`);
    const privs = u.privs || {};
    const groups = ['base', 'system', 'discuss', 'message', 'file', 'member', 'domain'];
    for (const g of groups) {
        const v = privs[g] || 0;
        console.log(`    ${g.padEnd(8)} 0x${(v >>> 0).toString(16).padStart(8, '0')}`);
    }
    console.log(`${C.gray}（修改权限请通过 /manage/permissions 页面）${C.reset}`);
}

// ============================================================
// user avatar —— 修改头像色
// ============================================================
function avatar(args) {
    const uid = args[0];
    const color = args[1];
    if (!uid || !color) { console.log(`${C.red}用法：user avatar <uid> <color>${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    // 必须校验：avatar_color 会被 14 处模板直接拼进 style="background:..."，
    // 而 nunjucks 的 autoescape 只管 HTML 字符、不管 `;` 与 `:`，
    // 所以 "red;position:fixed;inset:0;z-index:9999" 这类值会变成
    // 对所有访客生效的样式注入（含管理员）。这里与服务端
    // template.js 的 avatarColor 过滤器使用同一份白名单。
    const s = String(color).trim();
    const ok = /^#[0-9a-fA-F]{3,8}$/.test(s)
        || /^hsl\(\s*-?\d+(\.\d+)?\s*,\s*\d+(\.\d+)?%\s*,\s*\d+(\.\d+)?%\s*\)$/.test(s)
        || /^rgba?\([0-9,\s.]+\)$/.test(s)
        || /^[a-zA-Z]{3,20}$/.test(s);
    if (!ok) {
        console.log(`${C.red}✘ 不是合法的颜色值：${s}${C.reset}`);
        console.log(`${C.gray}  可用：#1890ff / #abc / hsl(210, 65%, 55%) / rgba(0,0,0,.5) / red${C.reset}`);
        return;
    }
    u.avatar_color = s;
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ 已更新 ${userTag(u)} 的头像色为 ${s}${C.reset}`);
}

// ============================================================
// user password —— 重置密码
// ============================================================
function password(args) {
    const uid = args[0];
    const newpwd = args[1];
    if (!uid || !newpwd) { console.log(`${C.red}用法：user password <uid> <newpwd>${C.reset}`); return; }
    if (newpwd.length < 4) { console.log(`${C.red}✘ 新密码至少 4 位${C.reset}`); return; }
    const u = resolveUser(uid);
    if (!u) { console.log(`${C.red}✘ 用户 ${uid} 不存在${C.reset}`); return; }
    u.password_hash = storage.hashPassword(newpwd);
    storage.saveUser(uid, u);
    console.log(`${C.green}✔ 已重置用户 ${uid}（${u.nickname}）的密码${C.reset}`);
}

module.exports = { nick, bio, priv, avatar, password };
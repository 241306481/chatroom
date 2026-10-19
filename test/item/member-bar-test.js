'use strict';
// 成员栏：禁言/踢出/管理 已在 /domain/x/users 直接可用（此前只在 manage_user 页）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const nunjucks = require('../../node_modules/nunjucks');

const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

const TPL = path.join(__dirname, '../../templates/users.html');
const src = fs.readFileSync(TPL, 'utf8');

check('users.html 模板语法正确', () => {
    nunjucks.compile(src, 'users.html');
});

check('成员栏含禁言操作（action=mute）', () => {
    assert.ok(/name="action" value="mute"/.test(src), '缺少禁言表单');
    assert.ok(/name="minutes"/.test(src), '禁言缺少时长输入');
});

check('成员栏含踢出/解封操作', () => {
    assert.ok(/value="\{% if u\.banned %\}unban\{% else %\}kick\{% endif %\}"/.test(src),
        '踢出/解封表单缺失');
    assert.ok(/u\.banned/.test(src), '未依据 banned 切换按钮');
});

check('踢出带二次确认（自定义弹窗 data-confirm）', () => {
    assert.ok(/data-confirm/.test(src), '踢出缺少确认');
});

check('成员栏含跳转管理页的链接', () => {
    assert.ok(/\/manage\/user#user-/.test(src), '缺少管理页链接');
});

check('所有者不出现管理操作', () => {
    assert.ok(/not u\.is_owner/.test(src), '所有者应被排除');
});

check('管理操作受 can_manage 控制', () => {
    assert.ok(/can_manage/.test(src), '缺少 can_manage 判断');
});

// 后端必须传这些标志，否则模板静默失效
const routeSrc = fs.readFileSync(
    path.join(__dirname, '../../lib/routes/domain.js'), 'utf8');

check('/users 路由传 can_manage 标志', () => {
    assert.ok(/can_manage:\s*can\('manage_user'\)/.test(routeSrc),
        '未传 can_manage');
});

check('/users 路由传 roles（供角色下拉）', () => {
    assert.ok(/roles:\s*can\('manage_user'\)/.test(routeSrc), '未传 roles');
});

check('/users 路由传 is_system_domain（system 域禁踢）', () => {
    assert.ok(/is_system_domain:\s*dn === 'system'/.test(routeSrc),
        '未传 is_system_domain');
});

check('buildUserList 返回真实 banned 态（供解封按钮）', () => {
    const h = fs.readFileSync(
        path.join(__dirname, '../../lib/routes/_helpers.js'), 'utf8');
    assert.ok(!/banned:\s*false, ban_reason/.test(h),
        'banned 仍是硬编码 false，成员栏无法显示解封');
    assert.ok(/isUserBannedInDomain/.test(h), '未读取真实封禁状态');
});

console.log('\n======== [回归] 成员栏内联管理 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
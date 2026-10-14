'use strict';
const { PRIV, hasPriv } = require('../../permissions');
const { UnauthorizedError } = require('../../auth/privilege');
const { render403 } = require('../../template');

// 系统级管理入口的闸门。
//
// MANAGE_PANEL 是「能进管理后台」的开关，system-roles 与 ip-bans 两个页面
// 都必须先过它。之前两份一模一样的实现各写各的，将来加严（例如要求
// 超级管理员、或加审计日志）极易只改一处，留下一个绕过口。
//
// 匿名与「已登录但无权限」要分开处理：
//   - 未登录            → 抛 UnauthorizedError，由 router 统一转成 302 跳登录页
//                         （API 请求转 401）
//   - 已登录但无权限    → 渲染 403
//
// 直接对匿名也渲染 403 会让未登录用户看到「仅系统管理员可访问」，
// 既没告诉他该登录，也泄露了「这个页面存在」的信息；而各路由是否声明
// { auth: true } 又不一致（ip-bans 声明了、system-roles 没有），
// 收敛到这里才能保证表现统一。
function requireSystemAdmin(user, res) {
    if (!user || !user.id) {
        throw new UnauthorizedError();
    }
    if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_PANEL)) {
        render403(res, '仅系统管理员可访问');
        return false;
    }
    return true;
}

module.exports = { requireSystemAdmin };
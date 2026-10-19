'use strict';
// 一次性提示消息（flash）。
// 不用 ?ok= 是因为文案明文放在 URL 里，任何人都能拼
// /home?ok=您的账号已被封禁 让页面显示假提示。
// 这里改为服务端写 HttpOnly 的短时 cookie，读一次即失效。

const { parseCookies } = require('./http-utils');

const COOKIE = 'flash';
const MAX_AGE = 15;      // 秒，够走完一次重定向

function encode(msg) {
    return encodeURIComponent(String(msg == null ? '' : msg).slice(0, 200));
}

function decode(raw) {
    try { return decodeURIComponent(raw); } catch (e) { return ''; }
}

// 生成 Set-Cookie 片段；msg 为空则返回清除指令
function cookie(msg, secure) {
    const base = COOKIE + '=' + (msg ? encode(msg) : '')
        + '; Path=/; HttpOnly; SameSite=Lax'
        + (secure ? '; Secure' : '');
    return base + '; Max-Age=' + (msg ? MAX_AGE : 0);
}

// 重定向并附带提示
function redirectWith(res, url, msg, secure) {
    const { redirect } = require('./routes/_helpers');
    res._flash = String(msg == null ? '' : msg).slice(0, 200);
    redirect(res, url, { 'Set-Cookie': cookie(msg, secure) });
}

// 从请求里取，挂在 res 上；每次请求有自己的 res，不会串
function capture(req, res) {
    const c = parseCookies(req && req.headers && req.headers.cookie);
    res._flash = c[COOKIE] ? decode(c[COOKIE]) : '';
}

// 注入模板数据
function attach(res, data) {
    if (data && typeof data === 'object') data.flash = res._flash || '';
    return data;
}

// 下行时清掉，避免刷新重复弹
function clear(res, secure) {
    try {
        const prev = res.getHeader('Set-Cookie');
        const v = cookie('', secure);
        res.setHeader('Set-Cookie', prev ? [].concat(prev, v) : v);
    } catch (e) { /* 响应已发出就忽略 */ }
}

module.exports = { COOKIE, cookie, redirectWith, capture, attach, clear };
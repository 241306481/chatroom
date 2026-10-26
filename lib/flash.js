'use strict';
const { parseCookies } = require('./http-utils');
const COOKIE = 'flash';
const MAX_AGE = 15;
function encode(msg) {
    return encodeURIComponent(String(msg == null ? '' : msg).slice(0, 200));
}
function decode(raw) {
    try { return decodeURIComponent(raw); } catch (e) { return ''; }
}
function cookie(msg, secure) {
    const base = COOKIE + '=' + (msg ? encode(msg) : '')
        + '; Path=/; HttpOnly; SameSite=Lax'
        + (secure ? '; Secure' : '');
    return base + '; Max-Age=' + (msg ? MAX_AGE : 0);
}
function redirectWith(res, url, msg, secure) {
    const { redirect } = require('./routes/_helpers');
    res._flash = String(msg == null ? '' : msg).slice(0, 200);
    redirect(res, url, { 'Set-Cookie': cookie(msg, secure) });
}
function capture(req, res) {
    const c = parseCookies(req && req.headers && req.headers.cookie);
    res._flash = c[COOKIE] ? decode(c[COOKIE]) : '';
}
function attach(res, data) {
    if (data && typeof data === 'object') data.flash = res._flash || '';
    return data;
}
function clear(res, secure) {
    try {
        const prev = res.getHeader('Set-Cookie');
        const v = cookie('', secure);
        res.setHeader('Set-Cookie', prev ? [].concat(prev, v) : v);
    } catch (e) {}
}
module.exports = { COOKIE, cookie, redirectWith, capture, attach, clear };

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
function jsonWith(res, url, msg, secure) {
    const { json } = require('./routes/_helpers');
    const message = String(msg == null ? '' : msg).slice(0, 200);
    json(res, 200, { ok: true, redirect: url, message }, {
        'Set-Cookie': cookie(message, secure),
    });
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
module.exports = { COOKIE, cookie, jsonWith, capture, attach, clear };

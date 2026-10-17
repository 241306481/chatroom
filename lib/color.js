'use strict';

// 终端是否支持 ANSI。默认有色，NO_COLOR 关闭，
// TERM=dumb 视为不支持，FORCE_COLOR 可强制打开
function colorEnabled(env) {
    env = env || process.env;
    if (env.NO_COLOR) return false;          // NO_COLOR 优先，FORCE_COLOR 也盖不过
    if (env.FORCE_COLOR) return true;
    if (String(env.TERM || '').toLowerCase() === 'dumb') return false;
    return true;
}

// 不支持时全部置空，调用点无需判空
function palette(names, raw, enabled) {
    const on = enabled === undefined ? colorEnabled() : enabled;
    const out = {};
    for (const k of names) out[k] = on ? raw[k] : '';
    return out;
}

module.exports = { colorEnabled, palette };
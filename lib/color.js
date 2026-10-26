'use strict';
function colorEnabled(env) {
    env = env || process.env;
    if (env.NO_COLOR) return false;
    if (env.FORCE_COLOR) return true;
    if (String(env.TERM || '').toLowerCase() === 'dumb') return false;
    return true;
}
function palette(names, raw, enabled) {
    const on = enabled === undefined ? colorEnabled() : enabled;
    const out = {};
    for (const k of names) out[k] = on ? raw[k] : '';
    return out;
}
module.exports = { colorEnabled, palette };

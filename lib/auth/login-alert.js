'use strict';
const logger = require('../logger');
const WINDOW_MS = 10 * 60 * 1000;
const THRESHOLD = 5;
const MAX_KEYS = 4096;
const ipHits = new Map();
const accountHits = new Map();
function sweep(map, now) {
    for (const [key, entry] of map) {
        if (now - entry.t >= WINDOW_MS) map.delete(key);
    }
    if (map.size > MAX_KEYS) {
        const extra = map.size - MAX_KEYS;
        let removed = 0;
        for (const key of map.keys()) {
            map.delete(key);
            if (++removed >= extra) break;
        }
    }
}
function bump(map, key, ip, dim) {
    const now = Date.now();
    let entry = map.get(key);
    if (!entry || now - entry.t >= WINDOW_MS) {
        entry = { n: 0, t: now, alerted: false };
        map.set(key, entry);
    }
    entry.n++;
    if (!entry.alerted && entry.n >= THRESHOLD) {
        entry.alerted = true;
        logger.security('LOGIN_ALERT', ip || '-',
            `dim=${dim} count=${entry.n} key=${key}`);
    }
}
function record(nickname, ip) {
    const account = String(nickname || '').trim().toLowerCase().slice(0, 64);
    if (ip) {
        const now = Date.now();
        sweep(ipHits, now);
        bump(ipHits, String(ip), ip, 'ip');
    }
    if (account) {
        const now = Date.now();
        sweep(accountHits, now);
        bump(accountHits, account, ip, 'account');
    }
}
function reset() {
    ipHits.clear();
    accountHits.clear();
}
let timer = null;
function start() {
    if (timer) return;
    timer = setInterval(() => {
        const now = Date.now();
        sweep(ipHits, now);
        sweep(accountHits, now);
    }, 5 * 60 * 1000);
    timer.unref();
}
start();
module.exports = { record, reset, THRESHOLD, WINDOW_MS };

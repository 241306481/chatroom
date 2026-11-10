'use strict';
const ONLINE_MAP = new Map();
const GLOBAL_COUNTS = new Map();
function setOnline(uid, domainName, online) {
    if (!uid || !domainName) return;
    if (!ONLINE_MAP.has(domainName)) ONLINE_MAP.set(domainName, new Map());
    const map = ONLINE_MAP.get(domainName);
    const cur = map.get(uid) || 0;
    const globalCur = GLOBAL_COUNTS.get(uid) || 0;
    if (online) {
        map.set(uid, cur + 1);
        GLOBAL_COUNTS.set(uid, globalCur + 1);
    } else {
        const next = cur - 1;
        if (next <= 0) map.delete(uid);
        else map.set(uid, next);
        const globalNext = globalCur - 1;
        if (globalNext <= 0) GLOBAL_COUNTS.delete(uid);
        else GLOBAL_COUNTS.set(uid, globalNext);
    }
    if (map.size === 0) ONLINE_MAP.delete(domainName);
}
function isOnline(uid, domainName) {
    const map = ONLINE_MAP.get(domainName);
    return !!map && map.has(uid);
}
function isOnlineAnywhere(uid) {
    return GLOBAL_COUNTS.has(uid);
}
function listOnline(domainName) {
    const map = ONLINE_MAP.get(domainName);
    return map ? Array.from(map.keys()) : [];
}
module.exports = { setOnline, isOnline, isOnlineAnywhere, listOnline };

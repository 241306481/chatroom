'use strict';
const ONLINE_MAP = new Map();

function setOnline(uid, domainName, online) {
    if (!ONLINE_MAP.has(domainName)) ONLINE_MAP.set(domainName, new Map());
    const map = ONLINE_MAP.get(domainName);
    const cur = map.get(uid) || 0;
    if (online) {
        map.set(uid, cur + 1);
    } else {
        const next = cur - 1;
        if (next <= 0) map.delete(uid);
        else map.set(uid, next);
    }
    if (map.size === 0) ONLINE_MAP.delete(domainName);
}

function isOnline(uid, domainName) {
    const map = ONLINE_MAP.get(domainName);
    return !!map && map.has(uid);
}

function isOnlineAnywhere(uid) {
    for (const map of ONLINE_MAP.values()) {
        if (map.has(uid)) return true;
    }
    return false;
}

module.exports = { setOnline, isOnline, isOnlineAnywhere };
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const paths = require('./paths');
const { ensureDir, writeJsonAtomic } = require('./fs-utils');

const ONLINE_MAP = new Map();
const GLOBAL_COUNTS = new Map();
const TTL_MS = 90 * 1000;
const HEARTBEAT_MS = 30 * 1000;
const READ_CACHE_MS = 1000;
const INSTANCE = process.pid + '-' + crypto.randomBytes(6).toString('hex');
const INSTANCE_FILE = path.join(paths.ONLINE_INSTANCES_DIR, INSTANCE + '.json');
let readCache = null;
let readCacheAt = 0;
let timer = null;
let exitHooked = false;

function snapshotDomains() {
    const domains = Object.create(null);
    for (const [dn, map] of ONLINE_MAP) {
        const users = Object.create(null);
        for (const [uid, count] of map) {
            if (count > 0) users[uid] = count;
        }
        if (Object.keys(users).length) domains[dn] = users;
    }
    return domains;
}

function publish() {
    try {
        ensureDir(paths.ONLINE_INSTANCES_DIR);
        writeJsonAtomic(INSTANCE_FILE, {
            pid: process.pid,
            host: os.hostname(),
            token: INSTANCE,
            updated_at: Date.now(),
            domains: snapshotDomains(),
        });
    } catch (e) {}
}

function cleanupStale() {
    let entries;
    try { entries = fs.readdirSync(paths.ONLINE_INSTANCES_DIR); }
    catch (e) { return; }
    const now = Date.now();
    for (const name of entries) {
        if (!name.endsWith('.json') || name === INSTANCE + '.json') continue;
        const p = path.join(paths.ONLINE_INSTANCES_DIR, name);
        try {
            if (now - fs.statSync(p).mtimeMs > TTL_MS * 2) {
                fs.rmSync(p, { force: true });
            }
        } catch (e) {}
    }
}

function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => {
        publish();
        cleanupStale();
    }, HEARTBEAT_MS);
    if (timer.unref) timer.unref();
    if (!exitHooked) {
        exitHooked = true;
        process.once('exit', () => {
            try { fs.rmSync(INSTANCE_FILE, { force: true }); } catch (e) {}
        });
    }
}

function readInstances() {
    const now = Date.now();
    if (readCache && now - readCacheAt < READ_CACHE_MS) return readCache;
    const domains = new Map();
    const any = new Set();
    let entries;
    try { entries = fs.readdirSync(paths.ONLINE_INSTANCES_DIR); }
    catch (e) {
        readCache = { domains, any };
        readCacheAt = now;
        return readCache;
    }
    for (const name of entries) {
        if (!name.endsWith('.json') || name === INSTANCE + '.json') continue;
        const p = path.join(paths.ONLINE_INSTANCES_DIR, name);
        let obj;
        try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); }
        catch (e) { continue; }
        if (!obj || typeof obj !== 'object') continue;
        const updated = Number(obj.updated_at);
        if (!Number.isFinite(updated) || now - updated > TTL_MS) continue;
        const ds = obj.domains;
        if (!ds || typeof ds !== 'object') continue;
        for (const dn of Object.keys(ds)) {
            const users = ds[dn];
            if (!users || typeof users !== 'object') continue;
            let set = domains.get(dn);
            if (!set) { set = new Set(); domains.set(dn, set); }
            for (const uid of Object.keys(users)) {
                if ((Number(users[uid]) || 0) <= 0) continue;
                set.add(uid);
                any.add(uid);
            }
        }
    }
    readCache = { domains, any };
    readCacheAt = now;
    return readCache;
}

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
    readCache = null;
    readCacheAt = 0;
    ensureTimer();
    publish();
}

function isOnline(uid, domainName) {
    const map = ONLINE_MAP.get(domainName);
    if (map && map.has(uid)) return true;
    const remote = readInstances().domains.get(domainName);
    return !!remote && remote.has(uid);
}

function isOnlineAnywhere(uid) {
    if (GLOBAL_COUNTS.has(uid)) return true;
    return readInstances().any.has(uid);
}

function listOnline(domainName) {
    const out = new Set();
    const map = ONLINE_MAP.get(domainName);
    if (map) for (const uid of map.keys()) out.add(uid);
    const remote = readInstances().domains.get(domainName);
    if (remote) for (const uid of remote) out.add(uid);
    return Array.from(out);
}

module.exports = { setOnline, isOnline, isOnlineAnywhere, listOnline };

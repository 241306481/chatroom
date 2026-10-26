'use strict';
const TWO32 = 4294967296;
function norm(perm) {
    if (perm == null) return { hi: 0, lo: 0 };
    if (typeof perm === 'object') {
        return {
            hi: (Number(perm.hi) || 0) >>> 0,
            lo: (Number(perm.lo) || 0) >>> 0,
        };
    }
    if (typeof perm === 'string') {
        const t = perm.trim();
        if (!/^\d+$/.test(t)) return { hi: 0, lo: 0 };
        const n = BigInt(t);
        return {
            hi: Number((n >> 32n) & 0xFFFFFFFFn) >>> 0,
            lo: Number(n & 0xFFFFFFFFn) >>> 0,
        };
    }
    const n = Number(perm);
    if (!Number.isFinite(n) || n <= 0) return { hi: 0, lo: 0 };
    if (n < TWO32) return { hi: 0, lo: n >>> 0 };
    return { hi: Math.floor(n / TWO32) >>> 0, lo: (n % TWO32) >>> 0 };
}
const bitOf = norm;
function or(a, b) {
    const x = norm(a), y = norm(b);
    return { hi: (x.hi | y.hi) >>> 0, lo: (x.lo | y.lo) >>> 0 };
}
function orMany(list) {
    let r = { hi: 0, lo: 0 };
    for (const b of list || []) r = or(r, b);
    return r;
}
function and(a, b) {
    const x = norm(a), y = norm(b);
    return { hi: (x.hi & y.hi) >>> 0, lo: (x.lo & y.lo) >>> 0 };
}
function not(a) {
    const x = norm(a);
    return { hi: (~x.hi) >>> 0, lo: (~x.lo) >>> 0 };
}
function has(perm, p) {
    const x = norm(perm), y = norm(p);
    if (y.hi) return ((x.hi & y.hi) >>> 0) === y.hi;
    return ((x.lo & y.lo) >>> 0) === y.lo;
}
function hasAny(perm, p) {
    const x = norm(perm), y = norm(p);
    if (y.hi && (x.hi & y.hi)) return true;
    return ((x.lo & y.lo) >>> 0) !== 0;
}
function eq(a, b) {
    const x = norm(a), y = norm(b);
    return x.hi === y.hi && x.lo === y.lo;
}
function toStr(perm) {
    const x = norm(perm);
    return (BigInt(x.hi) << 32n | BigInt(x.lo)).toString();
}
function bitByIndex(i) {
    const n = Number(i) || 0;
    if (n < 32) return { hi: 0, lo: (1 << n) >>> 0 };
    return { hi: (1 << (n - 32)) >>> 0, lo: 0 };
}
module.exports = {
    norm, bitOf, or, orMany, and, not, has, hasAny, eq, toStr, bitByIndex,
    TWO32,
};

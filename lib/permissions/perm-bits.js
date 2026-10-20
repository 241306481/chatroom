'use strict';
// 域权限位运算：双字表示 { hi, lo }，共 64 位
//
// 为什么不用单个 number：
// JS 位运算（| & ~）只有 32 位，1<<32 会回绕成 1，2**32 虽数值正确
// 却在 `a | b` 中被直接丢弃。位号 32 以后就没法用了。
// 现在位号 0..31 占低字，32..63 是高字，当前全部空着。
//
// 三种输入都能吃：
//   { hi, lo }  —— 存储里的原生格式
//   '123'      —— 表单提交的十进制字符串
//   123        —— 代码里的裸数字（当作低字）

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
        // 超过 2^53 的部分用 BigInt 解析，避免丢精度
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

// 位常量的位运算走这里（位常量本身可能是裸数字）
const bitOf = norm;

function or(a, b) {
    const x = norm(a), y = norm(b);
    return { hi: (x.hi | y.hi) >>> 0, lo: (x.lo | y.lo) >>> 0 };
}

// 多个位求并
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

// 是否含有全部 p 位
function has(perm, p) {
    const x = norm(perm), y = norm(p);
    if (y.hi) return ((x.hi & y.hi) >>> 0) === y.hi;
    return ((x.lo & y.lo) >>> 0) === y.lo;
}

// 是否含有任意 p 位
function hasAny(perm, p) {
    const x = norm(perm), y = norm(p);
    if (y.hi && (x.hi & y.hi)) return true;
    return ((x.lo & y.lo) >>> 0) !== 0;
}

function eq(a, b) {
    const x = norm(a), y = norm(b);
    return x.hi === y.hi && x.lo === y.lo;
}

// 转十进制字符串（展示/表单用）
function toStr(perm) {
    const x = norm(perm);
    return (BigInt(x.hi) << 32n | BigInt(x.lo)).toString();
}

// 按位序号造位：0..31 -> lo，32+ -> hi
function bitByIndex(i) {
    const n = Number(i) || 0;
    if (n < 32) return { hi: 0, lo: (1 << n) >>> 0 };
    return { hi: (1 << (n - 32)) >>> 0, lo: 0 };
}

module.exports = {
    norm, bitOf, or, orMany, and, not, has, hasAny, eq, toStr, bitByIndex,
    TWO32,
};
'use strict';
const assert = require('assert');
const { buildZip, crc32 } = require('../../lib/zip');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
check('CRC32 标准向量', () => {
    assert.strictEqual(crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
});
check('ZIP 结构、UTF-8 名称与内容可还原', () => {
    const entries = [
        { name: 'alpha.txt', data: Buffer.from('hello') },
        { name: '中文 (1).txt', data: Buffer.from('世界') },
    ];
    const zip = buildZip(entries);
    assert.strictEqual(zip.readUInt32LE(0), 0x04034B50);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i--) {
        if (zip.readUInt32LE(i) === 0x06054B50) { eocd = i; break; }
    }
    assert.ok(eocd >= 0, '缺少 EOCD');
    assert.strictEqual(zip.readUInt16LE(eocd + 8), entries.length);
    const out = [];
    let p = zip.readUInt32LE(eocd + 16);
    for (let i = 0; i < entries.length; i++) {
        assert.strictEqual(zip.readUInt32LE(p), 0x02014B50);
        const flags = zip.readUInt16LE(p + 8);
        const method = zip.readUInt16LE(p + 10);
        const crc = zip.readUInt32LE(p + 16);
        const size = zip.readUInt32LE(p + 24);
        const nameLen = zip.readUInt16LE(p + 28);
        const extraLen = zip.readUInt16LE(p + 30);
        const commentLen = zip.readUInt16LE(p + 32);
        const localOffset = zip.readUInt32LE(p + 42);
        const name = zip.slice(p + 46, p + 46 + nameLen).toString('utf8');
        assert.strictEqual(flags & 0x0800, 0x0800, '缺少 UTF-8 标志');
        assert.strictEqual(method, 0, '应为 store');
        assert.strictEqual(zip.readUInt32LE(localOffset), 0x04034B50);
        const localNameLen = zip.readUInt16LE(localOffset + 26);
        const localExtraLen = zip.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const data = zip.slice(dataStart, dataStart + size);
        assert.strictEqual(crc32(data), crc);
        out.push({ name, data: data.toString('utf8') });
        p += 46 + nameLen + extraLen + commentLen;
    }
    assert.deepStrictEqual(out, entries.map(e => ({ name: e.name, data: e.data.toString('utf8') })));
});
check('空 ZIP 合法', () => {
    const zip = buildZip([]);
    assert.strictEqual(zip.readUInt32LE(zip.length - 22), 0x06054B50);
    assert.strictEqual(zip.readUInt16LE(zip.length - 14), 0);
});
console.log('\n======== [回归] ZIP 批量下载 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(results.length - failed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const LOGS = path.join(ROOT, 'logs');
fs.rmSync(LOGS, { recursive: true, force: true });
fs.mkdirSync(LOGS, { recursive: true });
const logger = require('../../lib/logger');
const auditLog = require('../../lib/audit-log');
const chain = require('../../lib/audit-chain');
const results = [];
const failures = [];
function check(name, fn) {
    try { fn(); results.push(['PASS', name]); }
    catch (e) { results.push(['FAIL', name + ' -> ' + e.message]); failures.push(e); }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function logFile() {
    return fs.readdirSync(LOGS)
        .filter(name => /\.log$/.test(name) && !/\.\d+\.log$/.test(name))
        .map(name => path.join(LOGS, name))[0];
}
function records() {
    return fs.readFileSync(logFile(), 'utf8').split(/\r?\n/)
        .map(chain.parse).filter(Boolean);
}
function write(lines) {
    fs.writeFileSync(logFile(), lines.join('\n') + '\n', 'utf8');
}
(async () => {
    check('时间戳包含年月日', () => {
        assert.match(logger.ts(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
    logger.info('audit chain noisy line');
    logger.audit('1', 'root', '127.0.0.1', 'POST', '/manage/users', 200);
    logger.security('LOGIN_FAIL', '198.51.100.7', 'nickname=x');
    logger.audit('2', 'ops', '127.0.0.1', 'POST', '/manage/roles', 200);
    await sleep(200);
    await logger.close();
    const clean = fs.readFileSync(logFile(), 'utf8').split(/\r?\n/);
    check('审计与安全日志写入链标记', () => {
        const list = records();
        assert.ok(list.length >= 3, '链记录不足');
        assert.ok(list.some(record => record.payload.includes('[Audit]')));
        assert.ok(list.some(record => record.payload.includes('[Security]')));
    });
    check('链序号连续且前向哈希正确', () => {
        const list = records();
        for (let i = 1; i < list.length; i++) {
            assert.strictEqual(list[i].seq, list[i - 1].seq + 1);
            assert.strictEqual(list[i].prev, list[i - 1].hash);
        }
        assert.strictEqual(list[0].prev, chain.GENESIS);
    });
    check('verifyChain 对正常日志判定通过', () => {
        const result = auditLog.verifyChain();
        assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
        assert.ok(result.checked >= 3);
        assert.strictEqual(result.head, records().slice(-1)[0].hash);
    });
    check('检查点已落盘且与链头一致', () => {
        chain.flushCheckpoint();
        const checkpoint = chain.loadCheckpoint();
        assert.ok(checkpoint, '未写入检查点');
        assert.strictEqual(checkpoint.seq, records().slice(-1)[0].seq);
        assert.strictEqual(checkpoint.hash, records().slice(-1)[0].hash);
    });
    const original = clean.slice();
    check('篡改内容会被哈希校验发现', () => {
        const tampered = clean.map(line => chain.parse(line)
            ? line.replace('[Audit] root', '[Audit] rootx')
            : line);
        write(tampered);
        const result = auditLog.verifyChain();
        assert.strictEqual(result.ok, false, '篡改未被发现');
        assert.ok(result.errors.some(error => error.code === 'hash'));
    });
    check('删除中间记录会被断链校验发现', () => {
        const target = clean.findIndex(line => {
            const record = chain.parse(line);
            return record && record.payload.includes('[Security]');
        });
        const kept = clean.filter((line, index) => index !== target);
        write(kept);
        const result = auditLog.verifyChain();
        assert.strictEqual(result.ok, false, '断链未被发现');
        assert.ok(result.errors.some(error => error.code === 'gap' || error.code === 'link'));
    });
    check('检查点领先于日志会被发现', () => {
        write(clean.slice(0, -2));
        const result = auditLog.verifyChain();
        assert.strictEqual(result.ok, false, '未发现检查点领先');
        assert.ok(result.errors.some(error => error.code === 'checkpoint'));
    });
    write(original);
    check('恢复原始日志后重新通过', () => {
        assert.strictEqual(auditLog.verifyChain().ok, true);
    });
    check('控制台 audit verify 非交互模式可用', () => {
        const r = spawnSync(process.execPath,
            [path.join(ROOT, 'lib/console/index.js'), 'audit', 'verify'],
            { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
        const out = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
        assert.strictEqual(r.status, 0, out.slice(0, 300));
        assert.match(out, /审计日志哈希链/);
        assert.match(out, /通过/);
    });
    console.log('\n======== [回归] 审计日志哈希链 ========');
    for (const [status, name] of results) console.log(status.padEnd(5), name);
    const failed = results.filter(item => item[0] === 'FAIL').length;
    console.log((results.length - failed) + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})().catch(error => {
    console.error(error);
    console.log('0 passed, 1 failed');
    process.exit(1);
});

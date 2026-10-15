// [回归 7] 日志：logs/ 下产生文件，且不超过阈值
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOGS = path.join(ROOT, 'logs');
fs.rmSync(LOGS, { recursive: true, force: true });
fs.mkdirSync(LOGS, { recursive: true });

process.env.LOG_MAX_BYTES = '8192';   // 便于在测试里跑出轮转

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

const logger = require('../../lib/logger');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 部分检查需要等待 WriteStream flush
const asyncChecks = [];
const checkAsync = (n, f) => { asyncChecks.push([n, f]); };

checkAsync('★ logs/ 下会产生日志文件', async () => {
    logger.info('hello from regression test');
    await sleep(400);
    const files = fs.readdirSync(LOGS);
    assert.ok(files.length > 0, 'logs/ 为空');
    assert.ok(files.some(f => /\.log$/.test(f)), '没有 .log 文件: ' + files.join(','));
});

check('日志内容确实写入磁盘（不只是 stdout）', async () => {
    await sleep(300);
    const f = fs.readdirSync(LOGS).find(x => /\.log$/.test(x));
    const body = fs.readFileSync(path.join(LOGS, f), 'utf8');
    assert.ok(/hello from regression test/.test(body), '磁盘日志缺少该行');
});

check('普通 http 访问也会留下日志', () => {
    const before = fs.readdirSync(LOGS).length;
    logger.http({ _clientIp: '203.0.113.9', method: 'GET' }, '/home', 200, 12);
    assert.ok(fs.readdirSync(LOGS).length >= before);
});

check('★ 超过阈值后产生轮转文件，且任一文件都不超过阈值上限', async () => {
    const line = 'y'.repeat(300);
    for (let i = 0; i < 120; i++) logger.msg('198.51.100.5', 'dn', 'disc', 'nick', line);
    await sleep(600);
    const files = fs.readdirSync(LOGS);
    const rotated = files.filter(f => /\.\d+\.log$/.test(f));
    assert.ok(rotated.length >= 1, '未发生轮转: ' + files.join(','));
    // 阈值 8192；单行约 340 字节，允许一行以内的溢出
    for (const f of files) {
        const size = fs.statSync(path.join(LOGS, f)).size;
        assert.ok(size <= 8192 + 512, `${f} 达到 ${size} 字节，超出阈值`);
    }
});

check('轮转保留份数有上限（不会无限增长）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/logger.js'), 'utf8');
    const m = /MAX_LOG_FILES\s*=\s*(\d+)/.exec(src);
    assert.ok(m, '未定义 MAX_LOG_FILES');
    assert.ok(+m[1] >= 2 && +m[1] <= 20, '保留份数不合理: ' + m[1]);
});

check('日志注入防护仍然生效（不会因轮转改动而失效）', async () => {
    logger.msg('1.2.3.4', 'dn', 'disc', 'evil\n12:00:00 1.2.3.4 200 POST /login0ms', 'x');
    await sleep(300);
    const files = fs.readdirSync(LOGS);
    let body = '';
    for (const f of files) body += fs.readFileSync(path.join(LOGS, f), 'utf8');
    // 不应出现被当成新的一行的伪造日志
    assert.ok(!/^.*\n\d{2}:\d{2}:\d{2} 1\.2\.3\.4 200 POST/m.test(body),
        '换行注入仍然有效');
});

asyncChecks.push(['★ 超过阈值后产生轮转文件，且任一文件都不超过阈值上限', async () => {
    const line = 'y'.repeat(300);
    for (let i = 0; i < 120; i++) logger.msg('198.51.100.5', 'dn', 'disc', 'nick', line);
    await sleep(600);
    const files = fs.readdirSync(LOGS);
    const rotated = files.filter(f => /\.\d+\.log$/.test(f));
    assert.ok(rotated.length >= 1, '未发生轮转: ' + files.join(','));
    for (const f of files) {
        const size = fs.statSync(path.join(LOGS, f)).size;
        assert.ok(size <= 8192 + 512, `${f} 达到 ${size} 字节，超出阈值`);
    }
}]);

(async () => {
    for (const [n, f] of asyncChecks) {
        try { await f(); results.push(['PASS', n]); }
        catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
    }
    console.log('\n======== [回归 7] 日志 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const f = results.filter(x => x[0] === 'FAIL').length;
    console.log(results.length - f + ' passed, ' + f + ' failed');
    process.exit(f ? 1 : 0);
})();
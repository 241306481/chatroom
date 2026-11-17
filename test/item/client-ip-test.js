'use strict';
const assert = require('assert');
const path = require('path');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};
const MOD = require.resolve('../../lib/http-utils');
function loadWithProxy(on) {
    process.env.TRUST_PROXY = on ? '1' : '0';
    delete require.cache[MOD];
    return require('../../lib/http-utils');
}
function fakeReq(remote, headers) {
    return {
        socket: { remoteAddress: remote },
        headers: headers || {},
    };
}
check('未开启 TRUST_PROXY 时忽略转发头', () => {
    const { getClientIp } = loadWithProxy(false);
    const req = fakeReq('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' });
    assert.strictEqual(getClientIp(req), '127.0.0.1');
    assert.strictEqual(req._clientIpLocal, true);
});
check('开启 TRUST_PROXY 后使用转发 IP', () => {
    const { getClientIp } = loadWithProxy(true);
    const req = fakeReq('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' });
    assert.strictEqual(getClientIp(req), '203.0.113.9');
    assert.strictEqual(req._clientIpLocal, false);
    assert.strictEqual(req._clientIpFromProxy, true);
});
check('转发回环地址不能获得本地限流豁免', () => {
    const { getClientIp } = loadWithProxy(true);
    const req = fakeReq('127.0.0.1', { 'x-forwarded-for': '127.0.0.1' });
    assert.strictEqual(getClientIp(req), '127.0.0.1');
    assert.strictEqual(req._clientIpLocal, false, '伪造 127 不应触发本地豁免');
    const req2 = fakeReq('10.0.0.5', { 'x-forwarded-for': '127.0.0.2' });
    assert.strictEqual(getClientIp(req2), '10.0.0.5');
    assert.strictEqual(req2._clientIpLocal, false);
});
check('X-Real-IP 作为转发头回退', () => {
    const { getClientIp } = loadWithProxy(true);
    const req = fakeReq('127.0.0.1', { 'x-real-ip': '198.51.100.7' });
    assert.strictEqual(getClientIp(req), '198.51.100.7');
    assert.strictEqual(req._clientIpLocal, false);
});
check('直连回环地址仍是本地请求', () => {
    const { getClientIp } = loadWithProxy(true);
    const req = fakeReq('::ffff:127.0.0.1', {});
    assert.strictEqual(getClientIp(req), '127.0.0.1');
    assert.strictEqual(req._clientIpLocal, true);
    const req2 = fakeReq('10.0.0.8', {});
    assert.strictEqual(getClientIp(req2), '10.0.0.8');
    assert.strictEqual(req2._clientIpLocal, false);
});
process.env.TRUST_PROXY = '';
console.log('\n======== [回归] 客户端 IP 与代理信任 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);

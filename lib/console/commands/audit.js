'use strict';
const auditLog = require('../../audit-log');
const { C, padR } = require('../ui');
const ERROR_LABELS = {
    hash: '内容哈希不匹配',
    gap: '序号缺失或重复',
    link: '前向哈希不匹配',
    checkpoint: '检查点之后缺少日志',
    checkpoint_hash: '检查点哈希不匹配',
};
function verify() {
    const result = auditLog.verifyChain();
    const color = result.ok ? C.green : C.red;
    console.log(`${C.bold}审计日志哈希链${C.reset}`);
    console.log(`  状态：${color}${result.ok ? '通过' : '异常'}${C.reset}`);
    console.log(`  校验：${result.checked} 条`);
    if (result.checked) {
        console.log(`  范围：#${result.firstSeq} – #${result.lastSeq}`);
        console.log(`  摘要：${result.head}`);
    }
    if (result.checkpointSeq) console.log(`  检查点：#${result.checkpointSeq}`);
    if (result.errors.length) {
        console.log(`${C.red}  发现 ${result.errors.length} 个问题：${C.reset}`);
        for (const error of result.errors.slice(0, 20)) {
            const label = ERROR_LABELS[error.code] || error.code;
            console.log(`    · #${error.seq} ${label}`);
        }
    }
}
function tail(args) {
    const type = ['audit', 'security'].includes(args[0]) ? args[0] : 'all';
    const raw = type === args[0] ? args[1] : args[0];
    const limit = Math.min(500, Math.max(1, parseInt(raw, 10) || 20));
    const items = auditLog.events({ kind: type, limit });
    if (!items.length) {
        console.log(`${C.gray}（没有匹配的审计记录）${C.reset}`);
        return;
    }
    console.log(`${C.bold}最近 ${items.length} 条${type === 'all' ? '' : ' ' + type}记录${C.reset}`);
    for (const line of items) console.log(line);
}
function help() {
    console.log(`${C.bold}audit${C.reset}`);
    console.log(`  ${C.cyan}${padR('audit verify', 18)}${C.reset}校验哈希链完整性`);
    console.log(`  ${C.cyan}${padR('audit tail [n]', 18)}${C.reset}查看最近记录`);
    console.log(`  ${C.cyan}${padR('audit tail audit [n]', 18)}${C.reset}只看管理操作`);
    console.log(`  ${C.cyan}${padR('audit tail security [n]', 18)}${C.reset}只看安全事件`);
}
module.exports = {
    verify,
    tail,
    help,
    __default: verify,
};

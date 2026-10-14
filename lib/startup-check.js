'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// 启动自检
// ============================================================
// 目标：把「上线后才发现的问题」提前到启动那一刻。
// 每一项都给出可执行的结论，而不是只打印一句警告就继续跑。
const results = [];
function ok(name, detail) { results.push({ level: 'ok', name, detail: detail || '' }); }
function warn(name, detail) { results.push({ level: 'warn', name, detail: detail || '' }); }
function fail(name, detail) { results.push({ level: 'fail', name, detail: detail || '' }); }

// ---- Node 版本 ----
function checkNode() {
    const major = Number(process.versions.node.split('.')[0]);
    // 依赖 nunjucks 3 与 ws 8；本项目用到 crypto.scryptSync 等较新 API。
    if (major < 18) {
        fail('Node 版本', `当前 ${process.version}，需要 >= 18（推荐 20/22 LTS）`);
    } else {
        ok('Node 版本', process.version);
    }
}

// ---- 数据目录：存在性 / 可读 / 可写 ----
function checkDataDir(root) {
    const data = path.join(root, 'data');
    try {
        fs.mkdirSync(data, { recursive: true });
    } catch (e) {
        fail('数据目录创建', data + ' -> ' + e.message);
        return;
    }
    const probe = path.join(data, '.write-probe');
    try {
        fs.writeFileSync(probe, 'x');
        fs.unlinkSync(probe);
        ok('数据目录可写', data);
    } catch (e) {
        fail('数据目录可写', data + ' -> ' + e.message + '（请检查目录权限或磁盘是否已满）');
        return;
    }
    try {
        fs.readdirSync(data);
        ok('数据目录可读', data);
    } catch (e) {
        fail('数据目录可读', data + ' -> ' + e.message);
    }
    // 磁盘剩余空间
    try {
        const st = fs.statfsSync ? fs.statfsSync(data) : null;
        if (st) {
            const freeMb = Math.floor((st.bavail * st.bsize) / (1024 * 1024));
            if (freeMb < 50) warn('磁盘剩余空间', `仅剩 ${freeMb} MB，消息/文件写入会很快失败`);
            else ok('磁盘剩余空间', freeMb + ' MB');
        }
    } catch (e) { /* statfs 在部分平台不可用，忽略 */ }
}

// ---- 关键子目录 ----
function checkSubDirs(root) {
    for (const sub of ['users', 'domains']) {
        const p = path.join(root, 'data', sub);
        try {
            fs.mkdirSync(p, { recursive: true });
        } catch (e) {
            fail('子目录 ' + sub, p + ' -> ' + e.message);
            continue;
        }
        ok('子目录 ' + sub, p);
    }
}

// ---- 系统账户 / system 域是否健全 ----
function checkSystemState(storage) {
    try {
        const sys = storage.loadDomain('system');
        if (!sys || !sys.name) {
            fail('system 域', 'data/domains/system/config.json 缺失或损坏');
        } else {
            ok('system 域', sys.display_name || 'system');
        }
    } catch (e) {
        fail('system 域读取', e.message);
    }
    try {
        if (!storage.userExists(storage.SYSTEM_UID)) {
            fail('系统账户', 'uid=' + storage.SYSTEM_UID + ' 不存在');
        } else {
            ok('系统账户', 'uid=' + storage.SYSTEM_UID);
        }
    } catch (e) {
        fail('系统账户检查', e.message);
    }
    // 是否有真实用户（否则第一个注册者会成为超管，属于正常但值得提示的状态）
    try {
        const n = storage.listRealUsers().length;
        if (n === 0) warn('注册用户数', '0 —— 首个注册用户将自动成为超级管理员');
        else ok('注册用户数', String(n));
    } catch (e) { /* 忽略 */ }
}

// ---- TLS 证书 ----
function checkCert(root) {
    const cert = path.join(root, 'cert.pem');
    const key = path.join(root, 'key.pem');
    const hasCert = fs.existsSync(cert);
    const hasKey = fs.existsSync(key);
    if (hasCert && hasKey) {
        ok('TLS 证书', 'cert.pem + key.pem 已就位');
    } else if (hasCert !== hasKey) {
        fail('TLS 证书', 'cert.pem 与 key.pem 只存在其一，无法启用 HTTPS');
    } else {
        warn('TLS 证书', '未找到 cert.pem / key.pem，将以明文 HTTP/WS 启动');
    }
}

// ---- 可选环境变量提示 ----
function checkEnv() {
    const trust = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));
    if (!trust) {
        warn('TRUST_PROXY', '未设置：X-Forwarded-For 将被忽略（仅在反代后面才需要开启）');
    } else {
        warn('TRUST_PROXY', '已开启：会采信 X-Forwarded-For，请确保反代会覆盖客户端伪造的值');
    }
}

function run(root, storage) {
    checkNode();
    checkDataDir(root);
    checkSubDirs(root);
    checkSystemState(storage);
    checkCert(root);
    checkEnv();

    const failed = results.filter(r => r.level === 'fail');
    const warned = results.filter(r => r.level === 'warn');
    return { results, failed, warned };
}

function format(report) {
    const tag = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]' };
    const color = { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' };
    const reset = '\x1b[0m';
    const lines = report.results.map(r =>
        `${color[r.level]}${tag[r.level]}${reset} ${r.name}${r.detail ? '  ' + r.detail : ''}`);
    return lines;
}

module.exports = { run, format };
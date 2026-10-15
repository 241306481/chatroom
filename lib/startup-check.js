'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { X509Certificate } = require('crypto');


function makeCtx() {
    const results = [];
    return {
        results,
        ok: (name, detail) => results.push({ level: 'ok', name, detail: detail || '' }),
        warn: (name, detail) => results.push({ level: 'warn', name, detail: detail || '' }),
        fail: (name, detail) => results.push({ level: 'fail', name, detail: detail || '' }),
    };
}

// Node 版本
function checkNode(ctx) {
    const major = Number(process.versions.node.split('.')[0]);
    // 检查依赖版本
    if (major < 18) {
        ctx.fail('Node 版本', `当前 ${process.version}，需要 >= 18（推荐 20/22 LTS）`);
    } else {
        ctx.ok('Node 版本', process.version);
    }
}

// 数据目录读写
function checkDataDir(ctx, root) {
    const data = path.join(root, 'data');
    try {
        fs.mkdirSync(data, { recursive: true });
    } catch (e) {
        ctx.fail('数据目录创建', data + ' -> ' + e.message);
        return;
    }
    const probe = path.join(data, '.write-probe');
    try {
        fs.writeFileSync(probe, 'x');
        fs.unlinkSync(probe);
        ctx.ok('数据目录可写', data);
    } catch (e) {
        ctx.fail('数据目录可写', data + ' -> ' + e.message + '（请检查目录权限或磁盘是否已满）');
        return;
    }
    try {
        fs.readdirSync(data);
        ctx.ok('数据目录可读', data);
    } catch (e) {
        ctx.fail('数据目录可读', data + ' -> ' + e.message);
    }
    // 磁盘剩余空间
    try {
        const st = fs.statfsSync ? fs.statfsSync(data) : null;
        if (st) {
            const freeMb = Math.floor((st.bavail * st.bsize) / (1024 * 1024));
            if (freeMb < 50) ctx.warn('磁盘剩余空间', `仅剩 ${freeMb} MB，消息/文件写入会很快失败`);
            else ctx.ok('磁盘剩余空间', freeMb + ' MB');
        }
    } catch (e) { /* statfs 在部分平台不可用，忽略 */ }
}

// 关键子目录
function checkSubDirs(ctx, root) {
    for (const sub of ['users', 'domains']) {
        const p = path.join(root, 'data', sub);
        try {
            fs.mkdirSync(p, { recursive: true });
            ctx.ok('子目录 ' + sub, p);
        } catch (e) {
            ctx.fail('子目录 ' + sub, p + ' -> ' + e.message);
        }
    }
}

// 系统账户与域
function checkSystemState(ctx, storage) {
    try {
        const sys = storage.loadDomain('system');
        if (!sys || !sys.name) {
            ctx.fail('system 域', 'data/domains/system/config.json 缺失或损坏');
        } else {
            ctx.ok('system 域', sys.display_name || 'system');
        }
    } catch (e) {
        ctx.fail('system 域读取', e.message);
    }
    try {
        if (!storage.userExists(storage.SYSTEM_UID)) {
            ctx.fail('系统账户', 'uid=' + storage.SYSTEM_UID + ' 不存在');
        } else {
            ctx.ok('系统账户', 'uid=' + storage.SYSTEM_UID);
        }
    } catch (e) {
        ctx.fail('系统账户检查', e.message);
    }
    try {
        const n = storage.listRealUsers().length;
        if (n === 0) ctx.warn('注册用户数', '0 —— 首个注册用户将自动成为超级管理员');
        else ctx.ok('注册用户数', String(n));
    } catch (e) { /* 忽略 */ }
}

function checkJsonIntegrity(ctx, root) {
    const targets = [
        { dir: path.join(root, 'data', 'domains'), label: 'domains' },
        { dir: path.join(root, 'data', 'users'), label: 'users' },
    ];
    let checked = 0;
    let broken = [];
    for (const t of targets) {
        let names;
        try { names = fs.readdirSync(t.dir); } catch (e) { continue; }
        for (const name of names) {
            const file = path.join(t.dir, name, 'config.json');
            let text;
            try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
                // ENOENT 属正常
                if (e.code !== 'ENOENT') broken.push(`${t.label}/${name} (${e.code})`);
                continue;
            }
            try {
                const v = JSON.parse(text);
                // 须为对象
                if (!v || typeof v !== 'object') broken.push(`${t.label}/${name} (非对象)`);
                else checked++;
            } catch (e) {
                broken.push(`${t.label}/${name} (${e.message})`);
            }
        }
    }
    if (broken.length) {
        // 损坏不阻断启动
        ctx.warn('JSON 完整性', `发现 ${broken.length} 个损坏文件: ${broken.slice(0, 5).join('; ')}`
            + (broken.length > 5 ? ' …' : ''));
    } else {
        ctx.ok('JSON 完整性', `${checked} 个 config.json 全部可解析`);
    }
}

function checkTimezone(ctx) {
    let tz = '未知';
    try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '未知';
    } catch (e) { /* 忽略 */ }
    const isUTC = /^(UTC|Etc\/UTC|Etc\/GMT|GMT)$/i.test(tz);
    ctx.warn('系统时区',
        `${tz}${isUTC ? '（日期一律按 UTC 解析，封禁到期时间不会随本地时区漂移）' : ''}`);
}

function checkPort(ctx, port, host) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        let settled = false;
        const done = (level, detail) => {
            if (settled) return;
            settled = true;
            if (level) ctx[level]('监听端口', detail);
            resolve();
        };
        probe.once('error', err => {
            if (err.code === 'EADDRINUSE') {
                done('fail', `${host}:${port} 已被占用，换端口：set PORT=xxxx 后重试`);
            } else if (err.code === 'EACCES') {
                done('fail', `${host}:${port} 无权限绑定，1024 以下端口需要管理员权限`);
            } else {
                done('warn', `${host}:${port} 探测失败 -> ${err.message}`);
            }
        });
        probe.once('listening', () => {
            probe.close(() => done('ok', `${host}:${port} 可用`));
        });
        try {
            probe.listen(port, host);
        } catch (e) {
            done('warn', `${host}:${port} 探测异常 -> ${e.message}`);
        }
    });
}

// TLS 证书
function checkCert(ctx, root) {
    const certPath = path.join(root, 'cert.pem');
    const keyPath = path.join(root, 'key.pem');
    const hasCert = fs.existsSync(certPath);
    const hasKey = fs.existsSync(keyPath);
    if (hasCert !== hasKey) {
        ctx.fail('TLS 证书', 'cert.pem 与 key.pem 只存在其一，无法启用 HTTPS');
        return;
    }
    if (!hasCert) {
        ctx.warn('TLS 证书', '未找到 cert.pem / key.pem，将以明文 HTTP/WS 启动');
        return;
    }
    let x;
    try {
        x = new X509Certificate(fs.readFileSync(certPath));
    } catch (e) {
        ctx.fail('TLS 证书', `cert.pem 无法解析 -> ${e.message}`);
        return;
    }
    const daysLeft = Math.floor((Date.parse(x.validTo) - Date.now()) / 86400000);
    if (daysLeft < 0) {
        ctx.fail('TLS 证书', `已于 ${x.validTo} 过期（${-daysLeft} 天前），请重新生成：npm run cert`);
    } else if (daysLeft < 7) {
        ctx.fail('TLS 证书', `仅剩 ${daysLeft} 天到期（${x.validTo}），请尽快重新生成`);
    } else if (daysLeft < 30) {
        ctx.warn('TLS 证书', `剩余 ${daysLeft} 天到期（${x.validTo}），请尽快重新生成`);
    } else {
        ctx.ok('TLS 证书', `${x.subject}  剩余 ${daysLeft} 天（至 ${x.validTo}）`);
    }
}

// 可选环境变量提示
function checkEnv(ctx) {
    const trust = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));
    if (!trust) {
        ctx.warn('TRUST_PROXY', '未设置：X-Forwarded-For 将被忽略（仅在反代后面才需要开启）');
    } else {
        ctx.warn('TRUST_PROXY', '已开启：会采信 X-Forwarded-For，请确保反代会覆盖客户端伪造的值');
    }
}

function checkTimeData(ctx) {
    let bad;
    try { bad = require('./auth/bans').auditInvalidBans(); }
    catch (e) {
        ctx.warn('封禁数据有效性', '扫描失败: ' + e.message);
        return;
    }
    const n = bad.users.length + bad.domains.length + bad.mutes.length + bad.ipRules.length;
    if (!n) {
        ctx.ok('时间数据有效性', '封禁与禁言记录全部合法');
        return;
    }
    // 不阻断启动
    const detail = [`封禁 ${bad.users.length}`, `域内封禁 ${bad.domains.length}`,
        `禁言 ${bad.mutes.length}`, `IP 规则 ${bad.ipRules.length}`]
        .join('，')
        + ' 的解禁时间非法（按永久处理）'
        + '；控制台执行 "ban repair" 可归一为永久';
    ctx.warn('时间数据有效性', detail);
}

async function run(root, storage, opts) {
    const ctx = makeCtx();
    const o = opts || {};

    checkNode(ctx);
    checkDataDir(ctx, root);
    checkSubDirs(ctx, root);
    checkSystemState(ctx, storage);
    checkJsonIntegrity(ctx, root);
    checkTimeData(ctx);
    checkTimezone(ctx);
    checkCert(ctx, root);
    checkEnv(ctx);
    if (o.port) await checkPort(ctx, o.port, o.host || '0.0.0.0');

    return {
        results: ctx.results,
        failed: ctx.results.filter(r => r.level === 'fail'),
        warned: ctx.results.filter(r => r.level === 'warn'),
    };
}

// 仅 TTY 上色
function format(report) {
    const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
    const tag = { ok: '[ OK ]', warn: '[WARN]', fail: '[FAIL]' };
    const color = useColor
        ? { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m', reset: '\x1b[0m' }
        : { ok: '', warn: '', fail: '', reset: '' };
    return report.results.map(r =>
        `${color[r.level]}${tag[r.level]}${color.reset} ${r.name}${r.detail ? '  ' + r.detail : ''}`);
}

module.exports = { run, format };
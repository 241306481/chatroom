'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { X509Certificate } = require('crypto');

// ============================================================
// 启动自检
// ============================================================
// 目标：把「上线后才发现的问题」提前到启动那一刻。
// 每一项都给出可执行的结论，而不是只打印一句警告就继续跑。
//
// 结果数组在 run() 内部创建并通过 ctx 下传：模块级状态会让同进程内的
// 第二次调用把上一轮的结果一起累积进来（曾经踩过）。

function makeCtx() {
    const results = [];
    return {
        results,
        ok: (name, detail) => results.push({ level: 'ok', name, detail: detail || '' }),
        warn: (name, detail) => results.push({ level: 'warn', name, detail: detail || '' }),
        fail: (name, detail) => results.push({ level: 'fail', name, detail: detail || '' }),
    };
}

// ---- Node 版本 ----
function checkNode(ctx) {
    const major = Number(process.versions.node.split('.')[0]);
    // 依赖 nunjucks 3 与 ws 8；本项目用到 crypto.scryptSync 等较新 API。
    if (major < 18) {
        ctx.fail('Node 版本', `当前 ${process.version}，需要 >= 18（推荐 20/22 LTS）`);
    } else {
        ctx.ok('Node 版本', process.version);
    }
}

// ---- 数据目录：存在性 / 可读 / 可写 ----
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

// ---- 关键子目录 ----
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

// ---- 系统账户 / system 域是否健全 ----
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
    // 是否有真实用户（否则第一个注册者会成为超管，属于正常但值得提示的状态）
    try {
        const n = storage.listRealUsers().length;
        if (n === 0) ctx.warn('注册用户数', '0 —— 首个注册用户将自动成为超级管理员');
        else ctx.ok('注册用户数', String(n));
    } catch (e) { /* 忽略 */ }
}

// ---- JSON 完整性 ----
// 进程被强杀可能留下半截写入的 config.json；这种损坏平时不发作，
// 要等某个用户访问到那个域才在请求里抛出来。这里提前扫一遍。
// 注意只把**解析失败**算损坏：文件不存在是正常状态，不能误报。
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
                // ENOENT = 该条目本来就没有 config.json，属正常；其余按损坏处理
                if (e.code !== 'ENOENT') broken.push(`${t.label}/${name} (${e.code})`);
                continue;
            }
            try {
                const v = JSON.parse(text);
                // 再确认它是对象：'null'、'123'、'[]' 都能 parse 但对不上结构
                if (!v || typeof v !== 'object') broken.push(`${t.label}/${name} (非对象)`);
                else checked++;
            } catch (e) {
                broken.push(`${t.label}/${name} (${e.message})`);
            }
        }
    }
    if (broken.length) {
        // 损坏不阻断启动：多数情况下仍能服务其它域，直接退出反而是更差的选择。
        ctx.warn('JSON 完整性', `发现 ${broken.length} 个损坏文件: ${broken.slice(0, 5).join('; ')}`
            + (broken.length > 5 ? ' …' : ''));
    } else {
        ctx.ok('JSON 完整性', `${checked} 个 config.json 全部可解析`);
    }
}

// ---- 时区 ----
// 第五轮踩过的坑：无时区的时间戳（datetime-local 的原生格式）会被
// 按**服务器本地时区**解释，在 UTC+8 的机器上把合法的封禁时间判成无效。
// 现在 normalizeUntil 一律按 UTC 解析，但运行环境是 UTC 仍是值得知道的事实。
function checkTimezone(ctx) {
    let tz = '未知';
    try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '未知';
    } catch (e) { /* 忽略 */ }
    const isUTC = /^(UTC|Etc\/UTC|Etc\/GMT|GMT)$/i.test(tz);
    ctx.warn('系统时区',
        `${tz}${isUTC ? '（日期一律按 UTC 解析，封禁到期时间不会随本地时区漂移）' : ''}`);
}

// ---- 端口占用 ----
// 之前端口冲突要等 server.listen 之后的 'error' 事件才报，
// 那样自检已经全部打印完了。提前探一次，冲突能在自检阶段直接 fail。
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

// ---- TLS 证书 ----
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

// ---- 可选环境变量提示 ----
function checkEnv(ctx) {
    const trust = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));
    if (!trust) {
        ctx.warn('TRUST_PROXY', '未设置：X-Forwarded-For 将被忽略（仅在反代后面才需要开启）');
    } else {
        ctx.warn('TRUST_PROXY', '已开启：会采信 X-Forwarded-For，请确保反代会覆盖客户端伪造的值');
    }
}

async function run(root, storage, opts) {
    const ctx = makeCtx();
    const o = opts || {};

    checkNode(ctx);
    checkDataDir(ctx, root);
    checkSubDirs(ctx, root);
    checkSystemState(ctx, storage);
    checkJsonIntegrity(ctx, root);
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

// 颜色只在真正是终端时输出；重定向到文件 / 管道时保留裸 ANSI 转义符很难看。
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
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

// 上溯两级到根
const ROOT = path.join(__dirname, '..', '..');
const CERT = path.join(ROOT, 'cert.pem');
const KEY = path.join(ROOT, 'key.pem');
const DAYS = '825';   // CA/B 论坛对私有证书的常见上限；Apple 也要求 >= 398 天

function have(cmd, args) {
    try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; }
    catch (e) { return false; }
}

function lanIps() {
    const out = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const i of ifaces[name]) {
            if (i.family === 'IPv4' && !i.internal) out.push(i.address);
        }
    }
    return out;
}

function viaOpenssl(bin) {
    const ips = lanIps();
    const san = ['DNS:localhost', 'IP:127.0.0.1',
        ...ips.map(ip => 'IP:' + ip)].join(',');
    execFileSync(bin, [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', KEY, '-out', CERT,
        '-days', DAYS, '-subj', '/CN=chatroom.local',
        '-addext', 'subjectAltName=' + san,
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
    return san;
}

function findOpenssl() {
    if (have('openssl', ['version'])) return 'openssl';
    const candidates = [
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
        'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
        'C:\\Program Files\\OpenSSL-Win32\\bin\\openssl.exe',
    ];
    for (const c of candidates) {
        if (fs.existsSync(c) && have(c, ['version'])) return c;
    }
    return null;
}

function findMkcert() {
    if (have('mkcert', ['-version'])) return 'mkcert';
    const home = process.env.USERPROFILE || '';
    const candidates = [
        home + '\\bin\\mkcert.exe',
        (process.env.LOCALAPPDATA || '') + '\\Microsoft\\WinGet\\Links\\mkcert.exe',
        (process.env.ProgramData || '') + '\\chocolatey\\bin\\mkcert.exe',
        home + '\\scoop\\shims\\mkcert.exe',
        '/usr/local/bin/mkcert',
        '/opt/homebrew/bin/mkcert',
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c) && have(c, ['-version'])) return c;
    }
    return null;
}

// 不加 -install，否则会改信任库
function viaMkcert(bin) {
    const names = ['localhost', '127.0.0.1', ...lanIps()];
    execFileSync(bin, ['-cert-file', CERT, '-key-file', KEY, ...names],
        { stdio: ['ignore', 'ignore', 'ignore'] });
    return names.join(' / ');
}

// 老版本没有 -exportPEM。报错文案随语言变，故拿一个
// 必然无效的开关做对照：输出一致即说明都被拒了
function certutilSupportsExportPEM() {
    const norm = (s) => String(s || '').replace(/-exportPEM|-zzzzzNope/g, 'X')
        .replace(/\s+/g, ' ').trim();
    const bad = spawnSync('certutil', ['-zzzzzNope'], { encoding: 'utf8' });
    const real = spawnSync('certutil', ['-exportPEM'], { encoding: 'utf8' });
    const oBad = norm(bad.stdout) + norm(bad.stderr);
    const oReal = norm(real.stdout) + norm(real.stderr);
    if (!oReal) return false;
    return oReal !== oBad;
}

// 仅探测，不产生副作用
function canWindowsNative() {
    return process.platform === 'win32'
        && have('certutil', ['-?'])
        && certutilSupportsExportPEM();
}

// 临时证书用完即从证书存储删除
function viaWindowsNative() {
    if (!canWindowsNative()) return false;
    const out = path.join(os.tmpdir(), 'chatroom-cert-' + process.pid);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });

    // 必须 ASCII，PS 5.1 会踩代码页
    const ps = [
        "$ErrorActionPreference='Stop'",
        "$ips=@(" + lanIps().map((ip) => "'" + ip + "'").join(',') + ")",
        "$san='2.5.29.17={text}ipaddress=127.0.0.1&dns=localhost'",
        "foreach($ip in $ips){$san+=\"&ipaddress=$ip\"}",
        "$c=New-SelfSignedCertificate -Type SSLServerAuthentication -Subject 'CN=chatroom.local' -CertStoreLocation Cert:\\CurrentUser\\My -TextExtension $san -NotAfter (Get-Date).AddDays(825) -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment -KeyLength 2048",
        "$pfx=Join-Path $env:TEMP ('chatroom-'+[guid]::NewGuid().ToString()+'.pfx')",
        "try{",
        "  Export-PfxCertificate -Cert $c -FilePath $pfx -Password (ConvertTo-SecureString -String 'chatroom' -Force -AsPlainText)|Out-Null",
        "  certutil -user -f -p chatroom -exportPEM $pfx '" + out + "'|Out-Null",
        "}finally{",
        "  Remove-Item $pfx -Force -ErrorAction SilentlyContinue",
        "  Remove-Item ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint) -Force -ErrorAction SilentlyContinue",
        "}",
    ].join('\n');

    try {
        execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
            { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
        fs.rmSync(out, { recursive: true, force: true });
        return false;
    }
    // 文件名随版本而变，按内容认
    let cert = null, key = null;
    for (const f of fs.readdirSync(out)) {
        const p = path.join(out, f);
        const head = fs.readFileSync(p, 'utf8').slice(0, 200);
        if (/BEGIN CERTIFICATE/.test(head) && !cert) cert = p;
        if (/PRIVATE KEY/.test(head) && !key) key = p;
    }
    fs.rmSync(out, { recursive: true, force: true });
    if (!cert || !key) return false;
    fs.copyFileSync(cert, CERT);
    fs.copyFileSync(key, KEY);
    return true;
}

function opensslOut(bin, args) {
    const r = spawnSync(bin, args, { encoding: 'utf8' });
    if (r.error) return '';
    return String(r.stdout || '') + String(r.stderr || '');
}

function reportCert(bin, san) {
    const { X509Certificate } = require('crypto');
    let x;
    try {
        x = new X509Certificate(fs.readFileSync(CERT));
    } catch (e) {
        console.log('（证书已生成，但无法解析：' + e.message + '）');
        return;
    }
    console.log('\n---- 证书信息 ----');
    console.log('  Subject   :', x.subject);
    console.log('  Issuer    :', x.issuer);
    console.log('  有效期    :', x.validFrom, '→', x.validTo);
    try {
        console.log('  SAN       :', x.subjectAltName || san);
    } catch (e) { /* 忽略 */ }
    try {
        console.log('  SHA-256   :', x.fingerprint256);
    } catch (e) { /* 旧版本 Node 无此属性，忽略 */ }
    try {
        console.log('  openssl   :', opensslOut(bin, ['x509', '-fingerprint', '-sha256', '-noout', '-in', CERT]).trim());
    } catch (e) { /* 忽略 */ }
}

function printTrustSteps() {
    console.log('\n---- 让浏览器信任这张证书（否则每次访问都会告警）----');
    const p = os.platform();
    if (p === 'win32') {
        console.log('  命令行：');
        console.log('    certutil -addstore -user Root cert.pem');
        console.log('  图形界面：双击 cert.pem → 安装证书 → 本地计算机 → 受信任的根证书颁发机构');
    } else if (p === 'darwin') {
        console.log('  钥匙串访问 → 导入 cert.pem → 双击导入项 → 信任 → 始终信任');
        console.log('  或：sudo security add-trusted-cert -d -r trustRoot \\');
        console.log('        -k /Library/Keychains/System.keychain cert.pem');
    } else {
        console.log('  sudo cp cert.pem /usr/local/share/ca-certificates/chatroom.crt');
        console.log('  sudo update-ca-certificates');
        console.log('  （Debian/Ubuntu；RHEL 系用 update-ca-trust extract）');
    }
    console.log('  注意：只在自己信任的机器上这么做，且别把这张证书用于公网。');
}

// 全都没有则 exit 2，让调用方跳过而非判失败
function locate() {
    const oss = findOpenssl();
    if (oss) return { via: 'openssl: ' + oss, oss, run: () => viaOpenssl(oss) };

    const mk = findMkcert();
    if (mk) return { via: 'mkcert: ' + mk, oss: null, run: () => viaMkcert(mk) };

    if (canWindowsNative()) {
        return { via: 'PowerShell New-SelfSignedCertificate + certutil', oss: null, run: () => viaWindowsNative() };
    }
    return null;
}

function describeMissing() {
    console.log('\n找不到可用的证书生成工具，已试过：');
    console.log('  - openssl: ' + (findOpenssl() || '未找到'));
    console.log('  - mkcert: ' + (findMkcert() || '未找到'));
    console.log('  - PowerShell + certutil: ' + (canWindowsNative() ? '可用' : '不可用'));
    console.log('\n装任意一个后重跑：npm run cert');
    console.log('');
    if (process.platform === 'win32') {
        console.log('  装 OpenSSL（Git for Windows 自带，最省事）：');
        console.log('    winget install --id ShiningLight.OpenSSL.Light -e');
        console.log('  装 mkcert（跨平台一致，证书更干净）：');
        console.log('    winget install --id FiloSottile.mkcert -e');
        console.log('  若已装 Git for Windows，确认 ' + (process.env.ProgramFiles || 'C:\\Program Files')
            + '\\Git\\usr\\bin\\openssl.exe 存在。');
    } else {
        console.log('  Debian/Ubuntu : sudo apt-get install openssl');
        console.log('  macOS         : brew install openssl mkcert');
    }
    console.log('');
    console.log('不想装也可以：把任意自签名 cert.pem / key.pem 放到项目根目录即可自动启用 HTTPS。');
    console.log('不做 HTTPS 部署的话，忽略即可——服务端会以纯 HTTP 运行。');
}

// --check 只探测，不生成
if (process.argv.includes('--check')) {
    const probe = locate();
    if (probe) {
        console.log('可用工具: ' + probe.via);
        process.exit(0);
    }
    console.log('\n[无可用证书工具]');
    describeMissing();
    process.exit(2);
}

console.log('== 生成自签名证书 ==');
if (fs.existsSync(CERT) && fs.existsSync(KEY)) {
    console.log('cert.pem / key.pem 已存在，未做任何改动。');
    console.log('如需重新生成，请先删除这两个文件。');
    process.exit(0);
}

const tool = locate();
if (!tool) {
    describeMissing();
    process.exit(2);
}

const oss = tool.oss;
const san = tool.run();

if (os.platform() !== 'win32') {
    try { fs.chmodSync(KEY, 0o600); } catch (e) {
        console.log('（chmod 600 key.pem 失败：' + e.message + '）');
    }
}
console.log('\n已生成：cert.pem, key.pem   (' + tool.via + ')');
console.log('路径：', ROOT);
reportCert(oss, san);
printTrustSteps();
console.log('\n重启服务即可自动启用 HTTPS/WSS。');
console.log('启动自检会显示剩余有效期，到期前请重新运行 npm run cert。');
process.exit(0);

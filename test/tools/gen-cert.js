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

console.log('== 生成自签名证书 ==');
if (fs.existsSync(CERT) && fs.existsSync(KEY)) {
    console.log('cert.pem / key.pem 已存在，未做任何改动。');
    console.log('如需重新生成，请先删除这两个文件。');
    process.exit(0);
}

const oss = findOpenssl();
if (oss) {
    const san = viaOpenssl(oss);
    if (os.platform() !== 'win32') {
        try { fs.chmodSync(KEY, 0o600); } catch (e) {
            console.log('（chmod 600 key.pem 失败：' + e.message + '）');
        }
    }
    console.log('\n已生成：cert.pem, key.pem   (openssl: ' + oss + ')');
    console.log('路径：', ROOT);
    reportCert(oss, san);
    printTrustSteps();
    console.log('\n重启服务即可自动启用 HTTPS/WSS。');
    console.log('启动自检会显示剩余有效期，到期前请重新运行 npm run cert。');
    process.exit(0);
}

if (process.platform === 'win32') {
    console.log('\n未找到 openssl，但本机是 Windows。');
    console.log('可用的手工方式（PowerShell，需要管理员权限）：');
    console.log('');
    console.log('  $c = New-SelfSignedCertificate -Type SSLServerAuthentication '
        + '-Subject "CN=chatroom.local" -CertStoreLocation Cert:\\CurrentUser\\My');
    console.log('  Export-PfxCertificate -Cert $c -FilePath cert.pfx -Password (ConvertTo-SecureString -String "chatroom" -Force -AsPlainText)');
    console.log('  certutil -user -password chatroom -exportPEM cert.pfx .');
    console.log('  # 然后把 cert.pem / key.pem 移到项目根目录');
    console.log('');
    console.log('或安装 OpenSSL 后重跑：npm run cert');
    process.exit(1);
}

console.log('\n未找到 openssl。请安装后重试：npm run cert');
console.log('Debian/Ubuntu : sudo apt-get install openssl');
console.log('macOS         : brew install openssl');
process.exit(1);
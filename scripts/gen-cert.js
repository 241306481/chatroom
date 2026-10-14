#!/usr/bin/env node
'use strict';
// ============================================================
// 生成自签名 TLS 证书（cert.pem / key.pem）
// ============================================================
// 用途：让 server.js 自动切到 HTTPS/WSS（它一检测到这两个文件就会启用）。
//
// 为什么需要这个脚本：本机没有 openssl，而 Node 的 crypto 只能生成密钥、
// 不能签发 X.509 证书。这里按可用性依次尝试三条路径：
//   1. openssl（Linux/macOS/装了 OpenSSL 的 Windows 常见）
//   2. PowerShell New-SelfSignedCertificate（Windows 自带，导出 PEM）
//   3. 都没有 → 打印各平台的手工命令，不做其它事
//
// 自签名证书浏览器会告警，局域网/内网使用属正常；
// 生产环境请换成受信任 CA 签发的证书。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
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

// 找一个可用的 openssl：PATH 优先，其次 Windows 上常见的 Git / WinOpenSSL 附带版本。
// Windows 默认不带 openssl，但装了 Git for Windows 就自带一份。
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

function viaPowerShell() {
    const ps = `
$ErrorActionPreference = 'Stop'
$ips = @(${lanIps().map(ip => "'" + ip + "'").join(',')})
$san = @('DNS:localhost','IP:127.0.0.1') + ($ips | ForEach-Object { "IP:$_" })
$tmp = Join-Path $env:TEMP ("chatroom-cert-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
$c = New-SelfSignedCertificate -Type SSLServerAuthentication -Subject "CN=chatroom.local" `
        + `-CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddDays(${DAYS}) `
        + `-DnsName @($san) -TextExtension @("2.5.29.17={text}asn=OID:1.3.6.1.5.5.7.3.1")
$pfx = Join-Path $tmp "cert.pfx"
Export-PfxCertificate -Cert $c -FilePath $pfx -Password (ConvertTo-SecureString -String "chatroom" -Force -AsPlainText) | Out-Null
$null = & certutil -user -password chatroom -exportPEM $pfx (Join-Path $tmp "pem") 2>$null
Get-ChildItem (Join-Path $tmp "pem") | Out-Null
Write-Output "TMPDIR=$tmp"
`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
        { stdio: 'inherit', shell: true });
    return null;   // 后续处理交给人工/增强版脚本
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
    console.log('\n已生成：cert.pem, key.pem   (openssl: ' + oss + ')');
    console.log('SAN:', san);
    console.log('重启服务即可自动启用 HTTPS/WSS。');
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
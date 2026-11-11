'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULES = path.join(ROOT, 'node_modules');
const TARGETS = [
    '.bin',
    '.package-lock.json',
    'sharp',
    '@img',
    '@emnapi',
    'semver',
    'detect-libc',
    'tslib',
    'commander',
    path.join('nunjucks', 'browser'),
    path.join('nunjucks', 'bin'),
    path.join('nunjucks', 'README.md'),
];

function sizeOf(dir) {
    let total = 0;
    let count = 0;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return { total, count }; }
    for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = sizeOf(p);
            total += sub.total;
            count += sub.count;
        } else {
            try { total += fs.statSync(p).size; count++; } catch (e) {}
        }
    }
    return { total, count };
}

for (const rel of TARGETS) {
    try { fs.rmSync(path.join(MODULES, rel), { recursive: true, force: true }); }
    catch (e) {}
}

try {
    const manifest = path.join(MODULES, 'nunjucks', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (pkg.dependencies && pkg.dependencies.commander) {
        delete pkg.dependencies.commander;
        fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }
} catch (e) {}

const after = sizeOf(MODULES);
console.log('node_modules:', (after.total / 1024 / 1024).toFixed(2) + ' MB,',
    after.count, 'files');

'use strict';
const net = require('net');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitForServer(port, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const ok = await new Promise(res => {
            const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); res(true); });
            s.on('error', () => res(false));
        });
        if (ok) return true;
        await sleep(150);
    }
    throw new Error('server did not start on port ' + port);
}
function clearTlsArtifacts(root) {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['cert.pem', 'key.pem']) {
        const p = path.join(root, f);
        if (fs.existsSync(p)) {
            try { fs.rmSync(p); } catch (e) {}
        }
    }
}
function clearTestArtifacts(root) {
    const fs = require('fs');
    const path = require('path');
    for (const d of ['data', 'logs', 'evil', 'evil.json']) {
        const p = path.join(root, d);
        if (fs.existsSync(p)) {
            try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
        }
    }
    clearTlsArtifacts(root);
}
module.exports = { sleep, waitForServer, clearTlsArtifacts, clearTestArtifacts };

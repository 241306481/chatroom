'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let locked = '';
function setWsProtocol(p) {
    locked = (p === 'wss' || p === 'ws') ? p : '';
}
function getWsProtocol() {
    if (locked) return locked;
    return (fs.existsSync(path.join(ROOT, 'cert.pem'))
         && fs.existsSync(path.join(ROOT, 'key.pem'))) ? 'wss' : 'ws';
}
module.exports = { setWsProtocol, getWsProtocol };

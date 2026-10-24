'use strict';
// WS 协议在服务启动时锁死。运行中补放 pem 不会改变已起好的监听器，
// 页面和客户端必须跟着启动时的状态走，不能各自去 stat 证书。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let locked = '';

function setWsProtocol(p) {
    locked = (p === 'wss' || p === 'ws') ? p : '';
}

function getWsProtocol() {
    if (locked) return locked;
    // 没经过 server.js（如直接渲染模板的测试）时按证书推断
    return (fs.existsSync(path.join(ROOT, 'cert.pem'))
         && fs.existsSync(path.join(ROOT, 'key.pem'))) ? 'wss' : 'ws';
}

module.exports = { setWsProtocol, getWsProtocol };
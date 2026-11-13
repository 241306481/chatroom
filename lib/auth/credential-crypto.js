'use strict';
const crypto = require('crypto');
const nacl = require('tweetnacl');
const ALG = 'curve25519-xsalsa20-poly1305';
const MAX_PLAINTEXT_BYTES = 16 * 1024;
const MAX_VALUE_LENGTH = 4096;
const serverKeys = nacl.box.keyPair();
const keyId = crypto.createHash('sha256')
    .update(Buffer.from(serverKeys.publicKey))
    .digest('hex')
    .slice(0, 16);
function toBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}
function fromBase64(value, expectedLength) {
    if (typeof value !== 'string' || !value) return null;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
    const bytes = Buffer.from(value, 'base64');
    if (!bytes.length) return null;
    if (expectedLength && bytes.length !== expectedLength) return null;
    return bytes;
}
function publicKeyInfo() {
    return {
        ok: true,
        v: 1,
        alg: ALG,
        key_id: keyId,
        public_key: toBase64(serverKeys.publicKey),
    };
}
function openCredentialPayload(payload) {
    if (!payload || payload.v !== 1 || payload.alg !== ALG) {
        throw new Error('不支持的加密格式');
    }
    const clientPublicKey = fromBase64(payload.client_public_key, nacl.box.publicKeyLength);
    const nonce = fromBase64(payload.nonce, nacl.box.nonceLength);
    const ciphertext = fromBase64(payload.ciphertext);
    if (!clientPublicKey || !nonce || !ciphertext) {
        throw new Error('加密数据不完整');
    }
    const opened = nacl.box.open(ciphertext, nonce, clientPublicKey, serverKeys.secretKey);
    if (!opened) throw new Error('凭据解密失败');
    if (opened.length > MAX_PLAINTEXT_BYTES) throw new Error('凭据内容过大');
    let data;
    try {
        data = JSON.parse(Buffer.from(opened).toString('utf8'));
    } catch (e) {
        throw new Error('凭据内容无效');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('凭据内容无效');
    }
    const form = Object.create(null);
    for (const [key, value] of Object.entries(data)) {
        if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) continue;
        if (typeof value !== 'string' || value.length > MAX_VALUE_LENGTH) continue;
        form[key] = value;
    }
    return form;
}
module.exports = { publicKeyInfo, openCredentialPayload };

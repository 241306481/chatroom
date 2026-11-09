'use strict';
const CRLF2 = Buffer.from('\r\n\r\n');
function normalizeIp(ip) {
    if (!ip) return '';
    if (ip.startsWith('::ffff:')) ip = ip.substring(7);
    if (ip === '::1') ip = '127.0.0.1';
    return ip;
}
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.TRUST_PROXY || ''));
function getClientIp(req) {
    if (!req) return '-';
    if (TRUST_PROXY) {
        const xff = req.headers && req.headers['x-forwarded-for'];
        if (xff) {
            const first = String(xff).split(',')[0].trim();
            if (first) return normalizeIp(first) || '-';
        }
        const xri = req.headers && req.headers['x-real-ip'];
        if (xri) return normalizeIp(String(xri).trim()) || '-';
    }
    const ip = (req.socket && req.socket.remoteAddress)
        || (req.connection && req.connection.remoteAddress) || '';
    return normalizeIp(ip) || '-';
}
function safeDecode(s) {
    try {
        return decodeURIComponent(s);
    } catch (e) {
        return s;
    }
}
function parseCookies(header) {
    const out = {};
    if (!header) return out;
    header.split(';').forEach(p => {
        const i = p.indexOf('=');
        if (i < 0) return;
        out[p.substring(0, i).trim()] = safeDecode(p.substring(i + 1).trim());
    });
    return out;
}
function parseForm(body) {
    const out = {};
    if (!body) return out;
    body.split('&').forEach(p => {
        if (!p) return;
        const i = p.indexOf('=');
        if (i < 0) return;
        out[safeDecode(p.substring(0, i).replace(/\+/g, ' '))] =
            safeDecode(p.substring(i + 1).replace(/\+/g, ' '));
    });
    return out;
}
const MAX_MULTIPART_PARTS = 100;
const MAX_PART_HEADER = 8 * 1024;
const MAX_FIELD_NAME = 128;
function parseMultipart(buf, boundary) {
    boundary = boundary.replace(/^"|"$/g, '');
    const boundaryBuf = Buffer.from('--' + boundary);
    const result = {};
    let parts = 0;
    let start = buf.indexOf(boundaryBuf);
    while (start !== -1 && parts < MAX_MULTIPART_PARTS) {
        let pStart = start + boundaryBuf.length;
        if (buf[pStart] === 0x0d && buf[pStart + 1] === 0x0a) pStart += 2;
        if (buf[pStart] === 0x2d && buf[pStart + 1] === 0x2d) break;
        const next = buf.indexOf(boundaryBuf, pStart);
        if (next === -1) break;
        parts++;
        let pEnd = next;
        if (buf[pEnd - 2] === 0x0d && buf[pEnd - 1] === 0x0a) pEnd -= 2;
        const part = buf.slice(pStart, pEnd);
        const he = part.indexOf(CRLF2);
        if (he < 0 || he > MAX_PART_HEADER) { start = next; continue; }
        const headers = part.slice(0, he).toString('utf8');
        const data = part.slice(he + 4);
        const nameMatch = headers.match(/name="([^"]+)"/);
        const fileMatch = headers.match(/filename="([^"]+)"/);
        const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
        if (nameMatch) {
            const name = nameMatch[1];
            if (!name || name.length > MAX_FIELD_NAME) { start = next; continue; }
            let filename = fileMatch ? fileMatch[1] : null;
            if (filename) {
                try {
                    const raw = Buffer.from(filename, 'latin1');
                    const decoded = raw.toString('utf8');
                    if (!decoded.includes('\uFFFD')) filename = decoded;
                } catch (e) {}
            }
            result[name] = {
                filename,
                mime: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
                data,
            };
        }
        start = next;
    }
    return result;
}
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
module.exports = {
    normalizeIp, getClientIp, parseCookies, parseForm, parseMultipart,
    escapeHtml, safeDecode, TRUST_PROXY,
};

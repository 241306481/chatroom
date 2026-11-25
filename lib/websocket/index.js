'use strict';
const { WebSocketServer } = require('ws');
const storage = require('../storage');
const auth = require('../auth');
const messageLimit = require('../auth/message-limit');
const { getClientIp, parseCookies, safeDecode, isSecureRequest } = require('../http-utils');
const { PRIV, PERM, DUAL_CHECK, hasPriv, hasPrivAny, hasPerm, expandPerm, bits } = require('../permissions');
const discussWs = require('./discuss');
const dmWs = require('./dm');
const statusWs = require('./status');
const siteWs = require('./site');
const rateLimitsWs = require('./rate-limits');
const kick = require('./kick');
const registry = require('./registry');
const logger = require('../logger');
const DOMAIN_NAME_RE = /^[a-z0-9_-]{2,32}$/;
const DISCUSS_NAME_RE = /^[a-z0-9_-]{1,32}$/;
const UPGRADE_WINDOW_MS = 60 * 1000;
const UPGRADE_MAX = 60;
const HEARTBEAT_MS = 30 * 1000;
const _upgradeHits = new Map();
function originAllowed(req) {
    const origin = req.headers && req.headers.origin;
    if (!origin) return false;
    const host = String((req.headers && req.headers.host) || '').toLowerCase();
    if (!host) return false;
    const expectedProto = isSecureRequest(req) ? 'https:' : 'http:';
    try {
        const u = new URL(String(origin));
        return u.protocol === expectedProto && u.host.toLowerCase() === host;
    } catch (e) {
        return false;
    }
}
function upgradeAllowed(ip) {
    if (!ip) return true;
    const now = Date.now();
    let e = _upgradeHits.get(ip);
    if (!e || now - e.windowStart >= UPGRADE_WINDOW_MS) {
        e = { count: 0, windowStart: now };
        _upgradeHits.set(ip, e);
    }
    e.count++;
    if (_upgradeHits.size > 4096) {
        for (const [k, v] of _upgradeHits) {
            if (now - v.windowStart >= UPGRADE_WINDOW_MS) _upgradeHits.delete(k);
        }
    }
    return e.count <= UPGRADE_MAX;
}
const _upgradeSweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _upgradeHits) {
        if (now - v.windowStart >= UPGRADE_WINDOW_MS) _upgradeHits.delete(k);
    }
}, UPGRADE_WINDOW_MS);
_upgradeSweeper.unref();
function handleUpgrade(wss, req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    if (!originAllowed(req)) { socket.destroy(); return; }
    const mDiscuss = url.pathname.match(/^\/ws\/discuss\/([^/]+)\/([^/]+)$/);
    const mDM = url.pathname.match(/^\/ws\/dm$/);
    const mStatus = url.pathname.match(/^\/ws\/status\/([^/]+)$/);
    const mSite = url.pathname === '/ws/site';
    const mRateLimits = url.pathname === '/ws/manage/rate_limits';
    const ip = getClientIp(req);
    const ipLocal = req._clientIpLocal === true;
    if (mSite) {
        if (storage.isIpBanned(ip) || !upgradeAllowed(ip)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'site', { ip, ipLocal });
        });
        return;
    }
    const cookies = parseCookies(req.headers.cookie || '');
    const uid = cookies.token ? auth.getSessionUser(cookies.token, {
        ua: (req.headers && req.headers['user-agent']) || '',
        ip: ip || '',
    }) : null;
    if (!uid) { socket.destroy(); return; }
    const user = storage.loadUser(uid);
    if (!user.id) { socket.destroy(); return; }
    if (auth.isUserBanned(user)) { socket.destroy(); return; }
    if (storage.isIpBanned(ip)) { socket.destroy(); return; }
    if (!upgradeAllowed(ip)) { socket.destroy(); return; }
    if (mDiscuss) {
        const dn = safeDecode(mDiscuss[1]);
        const disc = safeDecode(mDiscuss[2]);
        if (!DOMAIN_NAME_RE.test(dn)) { socket.destroy(); return; }
        if (!DISCUSS_NAME_RE.test(disc)) { socket.destroy(); return; }
        const domain = storage.loadDomain(dn);
        if (!domain.name) { socket.destroy(); return; }
        if (!storage.loadDiscussion(dn, disc).name) { socket.destroy(); return; }
        if (auth.isUserBannedInDomain(domain, user.id)) { socket.destroy(); return; }
        const du = auth.getDomainUser(dn, user);
        const conf = DUAL_CHECK.view_discussion;
        const expanded = expandPerm(du.perm || 0);
        const privOk = du.is_privileged
            || hasPrivAny(user, conf.priv.group, conf.priv.bit);
        if (!privOk || !bits.has(expanded, conf.perm)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'discuss', {
                dn, disc, user, ip, ipLocal,
                token: cookies.token,
                ua: (req.headers && req.headers['user-agent']) || '',
            });
        });
        return;
    }
    if (mStatus) {
        const dn = safeDecode(mStatus[1]);
        if (!DOMAIN_NAME_RE.test(dn)) { socket.destroy(); return; }
        const domain = storage.loadDomain(dn);
        if (!domain.name) { socket.destroy(); return; }
        if (auth.isUserBannedInDomain(domain, user.id)) { socket.destroy(); return; }
        const du = auth.getDomainUser(dn, user);
        if (!hasPerm(du.perm, PERM.GENERAL.VIEW)) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'status', {
                dn, user, ip, ipLocal,
                token: cookies.token,
                ua: (req.headers && req.headers['user-agent']) || '',
            });
        });
        return;
    }
    if (mRateLimits) {
        if (!hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_ALL)
            && !hasPriv(user, 'system', PRIV.SYSTEM.MANAGE_RATE_LIMITS)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'rate_limits', {
                user, ip, ipLocal,
                token: cookies.token,
                ua: (req.headers && req.headers['user-agent']) || '',
            });
        });
        return;
    }
    if (mDM) {
        if (!hasPriv(user, 'base', PRIV.BASE.SEND_DM)) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'dm', {
                user, ip, ipLocal,
                token: cookies.token,
                ua: (req.headers && req.headers['user-agent']) || '',
            });
        });
        return;
    }
    socket.destroy();
}
function setup(server) {
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: messageLimit.WS_MAX_PAYLOAD,
    });
    const onUpgrade = (req, socket, head) => {
        try {
            handleUpgrade(wss, req, socket, head);
        } catch (e) {
            logger.error('WS upgrade error:', (req && req.url) || '', e);
            try { socket.destroy(); } catch (e2) {}
        }
    };
    server.on('upgrade', onUpgrade);
    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) {
                try { ws.terminate(); } catch (e) {}
                continue;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch (e) {}
        }
    }, HEARTBEAT_MS);
    heartbeat.unref();
    wss.on('connection', (ws, kind, ctx) => {
        ws.isAlive = true;
        if (ctx) {
            ws._token = ctx.token;
            ws._uid = ctx.user && ctx.user.id;
            ws._kind = kind;
        }
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('error', e => {
            logger.warn('WS error: ' + (e && e.message ? e.message : e));
        });
        try {
            if (kind === 'discuss') return discussWs.onConnect(ws, ctx);
            if (kind === 'status')  return statusWs.onConnect(ws, ctx);
            if (kind === 'dm')      return dmWs.onConnect(ws, ctx);
            if (kind === 'site')    return siteWs.onConnect(ws, ctx);
            if (kind === 'rate_limits') return rateLimitsWs.onConnect(ws, ctx);
        } catch (e) {
            logger.error('WS handler error:', kind, e);
            try { ws.terminate(); } catch (e2) {}
        }
    });
    return {
        wss,
        shutdown() {
            clearInterval(heartbeat);
            server.removeListener('upgrade', onUpgrade);
            let n = 0;
            for (const map of [registry.discussClients, registry.statusClients, registry.dmClients]) {
                if (!map) continue;
                for (const set of map.values()) {
                    for (const ws of Array.from(set)) {
                        try {
                            ws.close(1001, 'server shutting down');
                            n++;
                        } catch (e) {}
                    }
                }
            }
            for (const ws of Array.from(registry.siteClients)) {
                try {
                    ws.close(1001, 'server shutting down');
                    n++;
                } catch (e) {}
            }
            for (const ws of Array.from(registry.rateLimitClients)) {
                try {
                    ws.close(1001, 'server shutting down');
                    n++;
                } catch (e) {}
            }
            try { wss.close(); } catch (e) {}
            return n;
        },
    };
}
function broadcastDiscussEvent(dn, disc, payload) {
    registry.broadcastDiscuss(registry.discussKey(dn, disc), payload);
}
function broadcastMembersUpdate(dn) {
    try {
        const { buildUserList } = require('../routes/_helpers');
        const members = buildUserList(dn);
        const onlineCount = members.filter(u => u.online).length;
        registry.broadcastDomainEvent(dn, {
            type: 'members_update',
            members,
            online_count: onlineCount,
            total_count: members.length,
        });
    } catch (e) {
        console.error('[broadcastMembersUpdate]', e.message);
    }
}
function broadcastSiteAnnouncement(text) {
    try {
        registry.broadcastAll({
            type: 'site_announcement',
            text: String(text == null ? '' : text),
        });
    } catch (e) {
        console.error('[broadcastSiteAnnouncement]', e.message);
    }
}
function broadcastMembersUpdateForUser(uid) {
    if (!uid) return;
    let domains = [];
    try { domains = storage.listAllDomains(); }
    catch (e) { console.error('[broadcastMembersUpdateForUser]', e.message); return; }
    for (const dn of domains) {
        try {
            const domain = storage.loadDomain(dn);
            if (domain.members && domain.members[uid]) broadcastMembersUpdate(dn);
        } catch (e) {
            console.error('[broadcastMembersUpdateForUser]', dn, e.message);
        }
    }
}
function discussionPayload(dn, id, extra) {
    const cfg = storage.loadDiscussion(dn, id) || {};
    const stats = storage.getMessageStats(dn, id);
    return Object.assign({
        type: 'discussion_updated',
        id,
        title: cfg.title || '',
        pinned: !!cfg.pinned,
        count: stats.total,
    }, extra || {});
}
function broadcastDiscussionUpdate(dn, id, extra) {
    try {
        registry.broadcastDomainEvent(dn, discussionPayload(dn, id, extra));
    } catch (e) {
        console.error('[broadcastDiscussionUpdate]', e.message);
    }
}
function broadcastDiscussionActivity(dn, id) {
    try {
        const stats = storage.getMessageStats(dn, id);
        registry.broadcastStatus(dn, {
            type: 'discussion_activity',
            id,
            count: stats.total,
        });
    } catch (e) {
        console.error('[broadcastDiscussionActivity]', e.message);
    }
}
module.exports = {
    setup,
    kickFromDomain: kick.kickFromDomain,
    kickFromAllDomains: kick.kickFromAllDomains,
    kickByIpRule: kick.kickByIpRule,
    closeSession: registry.closeSession,
    closeUser: registry.closeUser,
    dmSend: registry.dmSend,
    broadcastDomainEvent: registry.broadcastDomainEvent,
    broadcastDiscussEvent,
    broadcastMembersUpdate,
    broadcastMembersUpdateForUser,
    broadcastSiteAnnouncement,
    broadcastDiscussionUpdate,
    broadcastDiscussionActivity,
};

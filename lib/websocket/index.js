'use strict';
const { WebSocketServer } = require('ws');
const storage = require('../storage');
const auth = require('../auth');
const { getClientIp, parseCookies, safeDecode } = require('../http-utils');
const { PRIV, PERM, DUAL_CHECK, hasPriv, hasPrivAny, hasPerm, expandPerm, bits } = require('../permissions');

const discussWs = require('./discuss');
const dmWs = require('./dm');
const statusWs = require('./status');
const kick = require('./kick');
const registry = require('./registry');
const logger = require('../logger');

const DOMAIN_NAME_RE = /^[a-z0-9_-]{2,32}$/;
const DISCUSS_NAME_RE = /^[a-z0-9_-]{1,32}$/;

const UPGRADE_WINDOW_MS = 60 * 1000;
const UPGRADE_MAX = 60;
const _upgradeHits = new Map();   // ip -> { count, windowStart }

function upgradeAllowed(ip) {
    if (!ip) return true;
    const now = Date.now();
    let e = _upgradeHits.get(ip);
    if (!e || now - e.windowStart >= UPGRADE_WINDOW_MS) {
        e = { count: 0, windowStart: now };
        _upgradeHits.set(ip, e);
    }
    e.count++;
    // 清理过期 IP 计数
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
if (_upgradeSweeper.unref) _upgradeSweeper.unref();

function handleUpgrade(wss, req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    const mDiscuss = url.pathname.match(/^\/ws\/discuss\/([^/]+)\/([^/]+)$/);
    const mDM = url.pathname.match(/^\/ws\/dm$/);
    const mStatus = url.pathname.match(/^\/ws\/status\/([^/]+)$/);

    const cookies = parseCookies(req.headers.cookie || '');
    const ip = getClientIp(req);
    // 带设备指纹校验，cookie 被搬到别处会失效
    const uid = cookies.token ? auth.getSessionUser(cookies.token, {
        ua: (req.headers && req.headers['user-agent']) || '',
        ip: ip || '',
    }) : null;
    if (!uid) { socket.destroy(); return; }

    const user = storage.loadUser(uid);
    if (!user.id) { socket.destroy(); return; }
    if (auth.isUserBanned(user)) { socket.destroy(); return; }

    if (storage.isIpBanned(ip)) { socket.destroy(); return; }

    // 升级频率限制
    if (!upgradeAllowed(ip)) { socket.destroy(); return; }

// 讨论区
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
        // 特权跳全局位
        const privOk = du.is_privileged
            || hasPrivAny(user, conf.priv.group, conf.priv.bit);
        if (!privOk || !bits.has(expanded, conf.perm)) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'discuss', { dn, disc, user, ip });
        });
        return;
    }

// 域状态
    if (mStatus) {
        const dn = safeDecode(mStatus[1]);
        if (!DOMAIN_NAME_RE.test(dn)) { socket.destroy(); return; }
        const domain = storage.loadDomain(dn);
        if (!domain.name) { socket.destroy(); return; }
        if (auth.isUserBannedInDomain(domain, user.id)) { socket.destroy(); return; }
        const du = auth.getDomainUser(dn, user);
        if (!hasPerm(du.perm, PERM.GENERAL.VIEW)) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'status', { dn, user, ip });
        });
        return;
    }

// 私信
    if (mDM) {
        if (!hasPriv(user, 'base', PRIV.BASE.SEND_DM)) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'dm', { user, ip });
        });
        return;
    }

    socket.destroy();
}

// 安装 WS 服务
function setup(server) {
    const wss = new WebSocketServer({ noServer: true });

    const onUpgrade = (req, socket, head) => {
        // 兜底捕获抛出
        try {
            handleUpgrade(wss, req, socket, head);
        } catch (e) {
            logger.error('WS upgrade error:', (req && req.url) || '', e);
            try { socket.destroy(); } catch (e2) {}
        }
    };
    server.on('upgrade', onUpgrade);

    wss.on('connection', (ws, kind, ctx) => {
        if (kind === 'discuss') return discussWs.onConnect(ws, ctx);
        if (kind === 'status')  return statusWs.onConnect(ws, ctx);
        if (kind === 'dm')      return dmWs.onConnect(ws, ctx);
    });

    return {
        wss,
        shutdown() {
            // 先停收新连接
            server.removeListener('upgrade', onUpgrade);

            // 广播关闭帧
            let n = 0;
            for (const map of [registry.discussClients, registry.statusClients, registry.dmClients]) {
                if (!map) continue;
                for (const set of map.values()) {
                    for (const ws of Array.from(set)) {
                        try {
                            ws.close(1001, 'server shutting down');
                            n++;
                        } catch (e) { /* 单个失败不影响其余 */ }
                    }
                }
            }
            try { wss.close(); } catch (e) { /* noServer 下可能立即抛，忽略 */ }
            return n;
        },
    };
}

function broadcastMembersUpdate(dn) {
    try {
        const { renderToString } = require('../template');
        const { buildUserList } = require('../routes/_helpers');
        const members = buildUserList(dn);
        const html = renderToString('_member_list.html', {
            all_members: members,
            online_count: members.filter(u => u.online).length,
            total_count: members.length,
        });
        registry.broadcastDomainEvent(dn, {
            type: 'members_update',
            html,
            online_count: members.filter(u => u.online).length,
            total_count: members.length,
        });
    } catch (e) {
        console.error('[broadcastMembersUpdate]', e.message);
    }
}

module.exports = {
    setup,
    kickFromDomain: kick.kickFromDomain,
    kickFromAllDomains: kick.kickFromAllDomains,
    kickByIpRule: kick.kickByIpRule,
    broadcastDomainEvent: registry.broadcastDomainEvent,
    broadcastMembersUpdate,
};
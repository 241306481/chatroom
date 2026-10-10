'use strict';
const { WebSocketServer } = require('ws');
const storage = require('../storage');
const auth = require('../auth');
const { getClientIp, parseCookies } = require('../http-utils');
const { PERM, DUAL_CHECK, hasPriv, hasPerm, expandPerm } = require('../permissions');

const discussWs = require('./discuss');
const dmWs = require('./dm');
const statusWs = require('./status');
const kick = require('./kick');
const registry = require('./registry');

// ============================================================
// 升级（HTTP → WebSocket）与路由
// ============================================================
function handleUpgrade(wss, req, socket, head) {
    const url = new URL(req.url, 'http://localhost');
    const mDiscuss = url.pathname.match(/^\/ws\/discuss\/([^/]+)\/([^/]+)$/);
    const mDM = url.pathname.match(/^\/ws\/dm$/);
    const mStatus = url.pathname.match(/^\/ws\/status\/([^/]+)$/);

    const cookies = parseCookies(req.headers.cookie || '');
    const uid = cookies.token ? auth.getSessionUser(cookies.token) : null;
    if (!uid) { socket.destroy(); return; }

    const user = storage.loadUser(uid);
    if (!user.id) { socket.destroy(); return; }
    if (auth.isUserBanned(user)) { socket.destroy(); return; }

    const ip = getClientIp(req);

    // ---------------- 讨论区 ----------------
    if (mDiscuss) {
        const dn = decodeURIComponent(mDiscuss[1]);
        const disc = decodeURIComponent(mDiscuss[2]);
        const domain = storage.loadDomain(dn);
        if (auth.isUserBannedInDomain(domain, user.id)) { socket.destroy(); return; }
        const du = auth.getDomainUser(dn, user);
        const conf = DUAL_CHECK.view_discussion;
        const expanded = expandPerm(du.perm || 0);
        if (!hasPriv(user.priv || 0, conf.priv) || (expanded & conf.perm) === 0) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'discuss', { dn, disc, user, ip });
        });
        return;
    }

    // ---------------- 域状态 ----------------
    if (mStatus) {
        const dn = decodeURIComponent(mStatus[1]);
        const domain = storage.loadDomain(dn);
        if (!domain.name) { socket.destroy(); return; }
        if (auth.isUserBannedInDomain(domain, user.id)) { socket.destroy(); return; }
        const du = auth.getDomainUser(dn, user);
        if (!hasPerm(du.perm, PERM.VIEW)) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'status', { dn, user, ip });
        });
        return;
    }

    // ---------------- 私信 ----------------
    if (mDM) {
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit('connection', ws, 'dm', { user, ip });
        });
        return;
    }

    socket.destroy();
}

// ============================================================
// 安装 WebSocket 服务
// ============================================================
function setup(server) {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        handleUpgrade(wss, req, socket, head);
    });

    wss.on('connection', (ws, kind, ctx) => {
        if (kind === 'discuss') return discussWs.onConnect(ws, ctx);
        if (kind === 'status')  return statusWs.onConnect(ws, ctx);
        if (kind === 'dm')      return dmWs.onConnect(ws, ctx);
    });
}

function broadcastMembersUpdate(dn) {
    try {
        const { renderToString } = require('../template');
        const { buildUserList } = require('../routes/_helpers');
        const members = buildUserList(dn);
        const html = renderToString('_member_list.html', {
            all_members: members,
            can_mute: true,
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
    broadcastDomainEvent: registry.broadcastDomainEvent,
    broadcastMembersUpdate,
};
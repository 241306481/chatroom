'use strict';
const { WebSocketServer } = require('ws');
const storage = require('../storage');
const auth = require('../auth');
const { getClientIp, parseCookies, safeDecode } = require('../http-utils');
const { PRIV, PERM, DUAL_CHECK, hasPriv, hasPrivAny, hasPerm, expandPerm } = require('../permissions');

const discussWs = require('./discuss');
const dmWs = require('./dm');
const statusWs = require('./status');
const kick = require('./kick');
const registry = require('./registry');
const logger = require('../logger');

// ============================================================
// 升级（HTTP → WebSocket）与路由
// ============================================================
// 与创建时同一套规则（见 storage/domains.js、storage/discussions.js）。
// 必须在任何 loadDomain/loadDiscussion 之前校验：这些函数会把名字拼进磁盘路径，
// 非法名字会抛异常，而本函数运行在 server 的 'upgrade' 回调中，无人捕获。
const DOMAIN_NAME_RE = /^[a-z0-9_-]{2,32}$/;
const DISCUSS_NAME_RE = /^[a-z0-9_-]{1,32}$/;

// ============================================================
// 升级频率限制
// ============================================================
// 每次升级都要做 loadUser / loadDomain / loadDiscussion 三次磁盘读，
// 没有上限的话单个客户端可以在几秒内打出成百上千次升级请求把磁盘打满。
// 用最简的固定窗口计数，够用且没有额外依赖。
//
// 阈值必须给正常客户端留足余量：一个页面同时开 discuss + status + dm
// 三条连接，客户端断线重连间隔 3 秒（见 static/js/chat/socket.js），
// 即最坏情况约 20 次/分钟，因此取 60 次/分钟。
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
    // 顺带做一次顺位清理：Map 会随不同 IP 无界增长
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
    const uid = cookies.token ? auth.getSessionUser(cookies.token) : null;
    if (!uid) { socket.destroy(); return; }

    const user = storage.loadUser(uid);
    if (!user.id) { socket.destroy(); return; }
    if (auth.isUserBanned(user)) { socket.destroy(); return; }

    const ip = getClientIp(req);

    // IP 封禁必须与 HTTP 侧同一道闸门。routes/index.js 对每个非静态请求都拦，
    // 这里漏掉的话，被封 IP 只要还持有会话 Cookie 就能直接开 socket，
    // 在唯一能改状态（发消息/表情/删除）的通道上完全绕过封禁。
    if (storage.isIpBanned(ip)) { socket.destroy(); return; }

    // 升级频率限制
    if (!upgradeAllowed(ip)) { socket.destroy(); return; }

    // ---------------- 讨论区 ----------------
    if (mDiscuss) {
        const dn = safeDecode(mDiscuss[1]);
        const disc = safeDecode(mDiscuss[2]);
        // URL 正则 ([^/]+) 挡不住百分号编码：a%2Fb 会解出 "a/b"，
        // 后续 loadDomain/appendMessage → assertSafeName 会抛异常，
        // 而 handleUpgrade 跑在 server 的 'upgrade' 回调里，抛出即终止整个进程。
        // 这里复用 HTTP 侧创建域/讨论时的同一套格式规则（domains.js / discussions.js），
        // 同时挡掉越界与不存在两种情况。
        if (!DOMAIN_NAME_RE.test(dn)) { socket.destroy(); return; }
        if (!DISCUSS_NAME_RE.test(disc)) { socket.destroy(); return; }
        const domain = storage.loadDomain(dn);
        if (!domain.name) { socket.destroy(); return; }
        if (!storage.loadDiscussion(dn, disc).name) { socket.destroy(); return; }
        if (auth.isUserBannedInDomain(domain, user.id)) { socket.destroy(); return; }
        const du = auth.getDomainUser(dn, user);
        const conf = DUAL_CHECK.view_discussion;
        const expanded = expandPerm(du.perm || 0);
        // 域所有者/全局管理员的授权来自域所有权或全局角色，跳过全局 priv 侧
        const privOk = du.is_privileged
            || hasPrivAny(user, conf.priv.group, conf.priv.bit);
        if (!privOk || (expanded & conf.perm) === 0) {
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
        const dn = safeDecode(mStatus[1]);
        if (!DOMAIN_NAME_RE.test(dn)) { socket.destroy(); return; }
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
        // 与 GET /messages 保持同一道全局权限检查，
        // 否则「发送私信」开关被关掉后仍可直接开 socket 绕过
        if (!hasPriv(user, 'base', PRIV.BASE.SEND_DM)) { socket.destroy(); return; }
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

    // 摘掉监听要用到同一个函数引用，所以先具名再挂载。
    const onUpgrade = (req, socket, head) => {
        // 兜底：handleUpgrade 里的任何抛出都会变成未捕获异常并终止进程
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

    // 关停接口：此前 server.js 是直接 require('./lib/websocket/registry')
    // 去翻三张 Map 关客户端的 —— 分层倒置，而且关闭窗口期内 upgrade 监听仍然
    // 有效，新进来的 socket 没有任何人负责回收。把这些收进本模块。
    return {
        wss,
        shutdown() {
            // 1. 先停止接受新的 WS 连接
            server.removeListener('upgrade', onUpgrade);

            // 2. 广播关闭帧（1001 = going away）
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
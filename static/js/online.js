// ============================================================
// 在线状态（供讨论页 / 状态 WS 共用）
// ============================================================
window.__onlineUsers = new Set();

window.setUserOnlineUI = function (el, online) {
    const dot = el.querySelector('.status-dot');
    if (dot) {
        dot.classList.toggle('green', online);
        dot.classList.toggle('red', !online);
    }
    if (el.classList.contains('member-item') || el.classList.contains('user-item')) {
        el.classList.toggle('offline', !online);
    }
};

window.updateUserStatus = function (uid, online) {
    if (online) window.__onlineUsers.add(uid);
    else window.__onlineUsers.delete(uid);
    document.querySelectorAll('[data-uid="' + uid + '"]').forEach(el => {
        window.setUserOnlineUI(el, online);
    });
    window.updateAllOnlineCounts();
};

window.applyOnlineList = function (uids) {
    uids = uids || [];
    document.querySelectorAll('[data-uid]').forEach(el => window.setUserOnlineUI(el, false));
    window.__onlineUsers = new Set(uids);
    uids.forEach(uid => {
        document.querySelectorAll('[data-uid="' + uid + '"]').forEach(el => {
            window.setUserOnlineUI(el, true);
        });
    });
    window.updateAllOnlineCounts();
};

window.updateAllOnlineCounts = function () {
    const memberList = document.getElementById('memberList');
    if (memberList) {
        const items = memberList.querySelectorAll('.member-item');
        let online = 0;
        items.forEach(el => {
            const dot = el.querySelector('.status-dot');
            if (dot && dot.classList.contains('green')) online++;
        });
        document.querySelectorAll('.online-badge').forEach(el => {
            el.textContent = '● ' + online + '/' + items.length;
        });
        document.querySelectorAll('.member-footer').forEach(el => {
            el.textContent = '在线 ' + online + ' / ' + items.length;
        });
    }
    const sidebar = document.querySelector('.sidebar-users');
    if (sidebar) {
        const count = window.__onlineUsers.size;
        sidebar.querySelectorAll('.online-count').forEach(el => {
            if (!el.textContent.includes('在线')) return;
            const m = el.textContent.match(/\/\s*(\d+)/);
            const total = m ? m[1] : '0';
            el.textContent = '在线 ' + count + ' / ' + total;
        });
    }
};

// ============================================================
// 域级在线状态 WebSocket
// ============================================================
(function () {
    const DOMAIN = window.__DOMAIN__ || '';
    if (!DOMAIN) return;
    if (document.getElementById('messageList')) return; // 讨论页有专属 WS
    // 未登录不连 WS：服务端 upgrade 阶段会直接 destroy，
    // 不加这道守卫会导致 onclose → connect 的无限重连。
    if (!window.MY_UID) return;

    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const wsUrl = WS_PROTOCOL + '://' + location.host + '/ws/status/' + encodeURIComponent(DOMAIN);
    let socket = null, reconnectTimer = null;
    let failCount = 0;
    const MAX_FAILS = 3;

    function connect() {
        socket = new WebSocket(wsUrl);
        socket.onopen = () => {
            failCount = 0;
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        };
        socket.onmessage = ev => {
            let data; try { data = JSON.parse(ev.data); } catch (e) { return; }
            if (data.type === 'user_online') window.updateUserStatus(data.user_id, true);
            else if (data.type === 'user_offline') window.updateUserStatus(data.user_id, false);
            else if (data.type === 'online_list') window.applyOnlineList(data.users);
            else if (data.type === 'members_update') {
                const list = document.getElementById('memberList');
                if (list) {
                    if (typeof data.html === 'string' && data.html) {
                        list.innerHTML = data.html;
                    }
                    // 与 chat/socket.js 共用同一段权限过滤，避免两处实现漂移
                    if (typeof window.applyMemberPermissions === 'function') {
                        window.applyMemberPermissions();
                    } else if (window.__CAN_MUTE__ !== true && window.__CAN_MUTE__ !== 'true') {
                        list.querySelectorAll('.member-actions').forEach(el => el.remove());
                    }
                    if (typeof window.updateAllOnlineCounts === 'function') {
                        window.updateAllOnlineCounts();
                    }
                }
            }
        };
        socket.onclose = () => {
            if (failCount >= MAX_FAILS) return;
            failCount++;
            reconnectTimer = setTimeout(connect, 3000);
        };
        socket.onerror = () => {};
    }
    connect();
})();
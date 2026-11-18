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
(function () {
    const DOMAIN = window.__DOMAIN__ || '';
    if (!DOMAIN) return;
    if (document.getElementById('messageList')) return;
    if (!window.MY_UID) return;
    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const wsUrl = WS_PROTOCOL + '://' + location.host + '/ws/status/' + encodeURIComponent(DOMAIN);
    let socket = null, reconnectTimer = null;
    let failCount = 0;
    const RETRY_BASE_MS = 3000;
    const RETRY_MAX_MS = 30000;
    function emitDomainEvent(data) {
        try {
            window.dispatchEvent(new CustomEvent('chatroom:domain-event', {
                detail: data,
            }));
        } catch (e) {}
    }
    function connect() {
        socket = new WebSocket(wsUrl);
        socket.onopen = () => {
            failCount = 0;
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        };
        socket.onmessage = ev => {
            let data; try { data = JSON.parse(ev.data); } catch (e) { return; }
            emitDomainEvent(data);
            if (data.type === 'user_online') window.updateUserStatus(data.user_id, true);
            else if (data.type === 'user_offline') window.updateUserStatus(data.user_id, false);
            else if (data.type === 'online_list') window.applyOnlineList(data.users);
            else if (data.type === 'members_update') {
                if (window.MemberList) window.MemberList.apply(data);
            } else if (data.type === 'kicked') {
                if (window.showToast) window.showToast('你已被移出 ' + (data.domain || '当前') + ' 域');
                setTimeout(function () { location.href = '/home'; }, 1500);
            } else if (data.type === 'domain_deleted') {
                if (window.showToast) window.showToast('域 ' + (data.name || '当前域') + ' 已被删除');
                setTimeout(function () { location.href = '/home'; }, 1500);
            }
        };
        socket.onclose = ev => {
            if (ev && ev.code === 4001) {
                setTimeout(function () { location.href = '/home'; }, 1500);
                return;
            }
            if (ev && ev.code === 4003) return;
            failCount++;
            const delay = Math.min(RETRY_MAX_MS,
                RETRY_BASE_MS * Math.pow(2, Math.min(failCount - 1, 3)));
            reconnectTimer = setTimeout(connect, delay);
        };
        socket.onerror = () => {};
    }
    connect();
})();

// ============================================================
// 讨论页 WebSocket 连接
// ============================================================
(function () {
    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const DOMAIN = window.__DOMAIN__ || '';
    const DISCUSS = window.__DISCUSS__ || '';
    if (!DOMAIN || !DISCUSS) return;
    if (!document.getElementById('messageList')) return;

    const wsUrl = `${WS_PROTOCOL}://${location.host}/ws/discuss/${DOMAIN}/${DISCUSS}`;
    let socket = null;
    let reconnectTimer = null;

    // ---------- 对外 API（供其他 chat 模块调用） ----------
    window.ChatWS = {
        send(payload) {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(payload));
            }
        },
        isOpen() {
            return socket && socket.readyState === WebSocket.OPEN;
        },
    };

    function applyMembersUpdate(data) {
        const list = document.getElementById('memberList');
        if (!list) return;
        list.innerHTML = data.html;
        if (!window.__CAN_MUTE__) {
            list.querySelectorAll('.member-actions').forEach(el => el.remove());
        }
        if (typeof window.updateAllOnlineCounts === 'function') {
            window.updateAllOnlineCounts();
        }
    }

    // ---------- 连接 ----------
    function connect() {
        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
            if (window.MY_UID) window.updateUserStatus(window.MY_UID, true);
            window.ChatRender.initReactions();
        };

        socket.onmessage = ev => {
            let data;
            try { data = JSON.parse(ev.data); } catch (e) { return; }
            const R = window.ChatRender;

            switch (data.type) {
                case 'new_message':
                    R.appendMessage(data.message);
                    if (window.MY_UID && data.message.user_id !== window.MY_UID) {
                        if (!R.isAtBottom()) R.showNewMsgBanner(1);
                    }
                    break;
                case 'message_deleted':
                    R.applyDelete(data.message_id);
                    break;
                case 'message_revoked':
                    R.applyRevoke(data);
                    break;
                case 'message_pinned':
                    R.updatePinned(data.message_id, data.pinned, data.message);
                    break;
                case 'reaction':
                    R.applyReaction(data.message_id, data.emoji,
                                    data.user_id, data.added, data.count);
                    break;
                case 'user_online':
                    window.updateUserStatus(data.user_id, true);
                    break;
                case 'user_offline':
                    window.updateUserStatus(data.user_id, false);
                    break;
                case 'online_list':
                    window.applyOnlineList(data.users);
                    break;
                case 'members_update':
                    applyMembersUpdate(data);
                    break;
                case 'discussion_created':
                    R.addDiscussionToSidebar(data.id, data.title);
                    break;
                case 'discussion_deleted':
                    R.removeDiscussionFromSidebar(data.id);
                    break;
                case 'kicked':
                    R.showToast('你已被移出「' + data.domain + '」');
                    setTimeout(function () { location.href = '/home'; }, 1500);
                    break;
                case 'error':
                    R.showToast(data.msg);
                    break;
            }
        };

        socket.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
        socket.onerror = () => {};
    }

    connect();

    // ---------- 触顶加载更老消息 ----------
    (function bindLoadMore() {
        const list = document.getElementById('messageList');
        if (!list) return;
        const dataEl = list;
        const initialOffset = parseInt(dataEl.dataset.offset || '0', 10) || 0;
        const initialLimit = parseInt(dataEl.dataset.limit || '100', 10) || 100;
        let total = parseInt(dataEl.dataset.total || '0', 10) || 0;
        const PAGE = 50;
        let loading = false;
        let loadedCount = initialOffset + initialLimit;
        if (total && loadedCount >= total) return;

        function loadMore() {
            if (loading) return;
            if (total && loadedCount >= total) return;
            loading = true;
            const url = '/domain/' + encodeURIComponent(DOMAIN)
                + '/discuss/' + encodeURIComponent(DISCUSS)
                + '/messages?offset=' + loadedCount + '&limit=' + PAGE;
            fetch(url).then(function (r) { return r.json(); }).then(function (res) {
                if (!res || !res.ok) { loading = false; return; }
                if (typeof res.total === 'number' && res.total > total) {
                    total = res.total;
                }
                const msgs = res.messages || [];
                msgs.forEach(function (m) {
                    window.ChatRender.prependMessage(m);
                });
                loadedCount += msgs.length;
                if (res.has_more === false) total = loadedCount;
                loading = false;
            }).catch(function () { loading = false; });
        }

        list.addEventListener('scroll', function () {
            const distanceFromTop = -list.scrollTop;
            const maxScroll = list.scrollHeight - list.clientHeight;
            if (maxScroll - distanceFromTop < 300) loadMore();
        }, { passive: true });
    })();

    // ---------- 初始渲染 ----------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.ChatRender.renderAllHistory());
    } else {
        window.ChatRender.renderAllHistory();
    }

    // ---------- 键盘快捷键 ----------
    const input = document.getElementById('msgInput');
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'Enter') window.sendMessage();
        });
    }

    // ---------- 滚动到底 ----------
    const l = document.getElementById('messageList');
    if (l) l.scrollTop = 0;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const list = document.getElementById('messageList');
            if (list) list.scrollTop = 0;
        });
    }

    (function jumpToHash() {
        const h = location.hash;
        if (!h || !h.startsWith('#msg-')) return;
        const id = h.substring(5);
        const el = document.querySelector('.message[data-id="' + id + '"]');
        if (!el) return;
        setTimeout(() => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight');
            setTimeout(() => el.classList.remove('highlight'), 2000);
        }, 300);
    })();
})();
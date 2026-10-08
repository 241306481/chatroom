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
                    R.scrollBottom();
                    break;
                case 'message_deleted':
                    R.removeMessage(data.message_id);
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
    window.ChatRender.scrollBottom();
})();
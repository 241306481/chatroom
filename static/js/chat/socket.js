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

    // 首屏的成员列表是服务端渲染的，members_update 之前就已经带着禁言按钮；
    // 之前这段清理只挂在 members_update 分支上，导致没有任何成员变动时
    // 普通成员在页面上始终看得到（甚至对自己）🔇，点下去才吃 403。
    // 提取成函数并在页面加载时也执行一次。
    function applyMemberPermissions() {
        const list = document.getElementById('memberList');
        if (!list) return;
        if (window.__CAN_MUTE__ === true || window.__CAN_MUTE__ === 'true') return;
        list.querySelectorAll('.member-actions').forEach(el => el.remove());
    }
    window.applyMemberPermissions = applyMemberPermissions;

    function applyMembersUpdate(data) {
        const list = document.getElementById('memberList');
        if (!list) return;
        if (typeof data.html === 'string' && data.html) {
            list.innerHTML = data.html;
        }
        applyMemberPermissions();
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
                case 'new_message': {
                    const atBottom = R.isAtBottom();
                    R.appendMessage(data.message);
                    if (window.MY_UID && data.message.user_id !== window.MY_UID && !atBottom) {
                        R.showNewMsgBanner(1);
                    }
                    // 列表变了，行内搜索的快照与计数必须重算
                    if (typeof window.__chatSearchReapply === 'function') {
                        window.__chatSearchReapply();
                    }
                    break;
                }
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

    (function jumpToHash() {
        const h = location.hash;
        if (!h || !h.startsWith('#msg-')) return;
        const id = h.substring(5);

        function tryScroll(attempts) {
            const el = document.querySelector('.message[data-id="' + id + '"]');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('highlight');
                setTimeout(() => el.classList.remove('highlight'), 2000);
                return;
            }
            if (attempts <= 0) return;
            // 直接以 urgent 模式回溯（无延迟、无 loading 占位）
            if (window.__chatLoadOlder) {
                window.__chatLoadOlder(true);
                // 视觉反馈：把视口推到内容最上方，让用户看到「正在往上翻找」
                const list = document.getElementById('messageList');
                if (list) list.scrollTop = -list.scrollHeight;
            }
            setTimeout(() => tryScroll(attempts - 1), 250);
        }
        setTimeout(() => tryScroll(30), 200);
    })();

    // ============================================================
    // 分片加载更老消息（column-reverse）
    // ============================================================
    (function bindLoadOlder() {
        const list = document.getElementById('messageList');
        if (!list) return;

        let loading = false;
        let hasMoreOlder = true;
        // oldestLoaded = 服务端首屏跳过的条数 + 首屏返回条数
        const initialOffset = parseInt(list.dataset.offset || '0', 10) || 0;
        const initialLimit = parseInt(list.dataset.limit || '100', 10) || 100;
        const total = parseInt(list.dataset.total || '0', 10) || 0;
        let oldestLoaded = initialOffset + initialLimit;
        if (total > 0 && oldestLoaded >= total) hasMoreOlder = false;

        function showLoading() {
            const inner = list.querySelector('.message-list-inner') || list;
            if (inner.querySelector('.loading-older')) return;
            const el = document.createElement('div');
            el.className = 'loading-older';
            el.textContent = '正在加载…';
            inner.appendChild(el);
        }

        function hideLoading() {
            const inner = list.querySelector('.message-list-inner') || list;
            const el = inner.querySelector('.loading-older');
            if (el) el.remove();
        }

        function loadMore(urgent) {
            if (loading) return;
            if (!hasMoreOlder) return;

            const dn = window.__DOMAIN__;
            const disc = window.__DISCUSS__;
            if (!dn || !disc) return;

            // urgent 模式（hash 定位）：跳过 loading 占位和延迟
            if (!urgent) showLoading();
            loading = true;

            const url = '/domain/' + encodeURIComponent(dn)
                + '/discuss/' + encodeURIComponent(disc)
                + '/messages?offset=' + oldestLoaded + '&limit=50';

            const delay = urgent ? 0 : 500;

            setTimeout(() => {
                fetch(url).then((r) => r.json()).then((res) => {
                    if (!urgent) hideLoading();
                    loading = false;
                    if (!res.ok || !res.messages || !res.messages.length) {
                        hasMoreOlder = false;
                        return;
                    }
                    // column-reverse：appendChild 到 inner 末尾 = 视觉更上方
                    res.messages.forEach((m) => {
                        if (window.ChatRender && window.ChatRender.prependMessage) {
                            window.ChatRender.prependMessage(m);
                        }
                    });
                    // 回溯加载同样改变了列表，行内搜索需要重算
                    if (typeof window.__chatSearchReapply === 'function') {
                        window.__chatSearchReapply();
                    }
                    oldestLoaded += res.messages.length;
                    if (res.messages.length < 50 || oldestLoaded >= total) {
                        hasMoreOlder = false;
                    }
                }).catch(() => {
                    if (!urgent) hideLoading();
                    loading = false;
                });
            }, delay);
        }

        // 供 hash 定位以 urgent 模式触发（闭包状态与 scroll 触发共享）
        window.__chatLoadOlder = loadMore;

        list.addEventListener('scroll', function () {
            // column-reverse 下：scrollTop = 0 是底部，负数是向上滚
            const distanceFromTop = -(list.scrollTop);
            const maxScroll = list.scrollHeight - list.clientHeight;
            if (maxScroll - distanceFromTop < 300) {
                loadMore();
            }
        }, { passive: true });
    })();
    // 首屏也要应用一次权限过滤（见 applyMemberPermissions 的说明）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.applyMemberPermissions);
    } else {
        window.applyMemberPermissions();
    }
})();
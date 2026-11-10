(function () {
    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const DOMAIN = window.__DOMAIN__ || '';
    const DISCUSS = window.__DISCUSS__ || '';
    if (!DOMAIN || !DISCUSS) return;
    if (!document.getElementById('messageList')) return;
    const wsUrl = `${WS_PROTOCOL}://${location.host}/ws/discuss/${DOMAIN}/${DISCUSS}`;
    let socket = null;
    let reconnectTimer = null;
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
    function appendDiscussFile(file) {
        const panel = document.querySelector('.discuss-file-sidebar');
        if (!panel || !file || !file.id) return;
        const items = panel.querySelectorAll('.file-sidebar-item');
        for (const item of items) {
            if (item.dataset.fileId === String(file.id)) return;
        }
        let list = panel.querySelector('[data-file-list]');
        if (!list) {
            list = document.createElement('div');
            list.className = 'file-sidebar-list';
            list.dataset.fileList = '';
            const empty = panel.querySelector('.empty');
            if (empty) empty.remove();
            panel.appendChild(list);
        }
        const item = document.createElement('div');
        item.className = 'file-sidebar-item';
        item.dataset.fileId = String(file.id);
        const main = document.createElement('a');
        main.className = 'file-sidebar-main';
        main.href = file.url || '#';
        main.target = '_blank';
        main.rel = 'noopener';
        main.title = file.filename || '';
        const icon = document.createElement('span');
        icon.className = 'file-sidebar-icon';
        icon.textContent = file.icon || '📄';
        const wrap = document.createElement('span');
        wrap.className = 'file-sidebar-text';
        const name = document.createElement('span');
        name.className = 'file-sidebar-name';
        name.textContent = file.filename || '';
        const meta = document.createElement('span');
        meta.className = 'file-sidebar-meta';
        meta.textContent = (file.size_str || '') + ' · ' + (file.uploader_name || '?');
        wrap.appendChild(name);
        wrap.appendChild(meta);
        main.appendChild(icon);
        main.appendChild(wrap);
        const download = document.createElement('a');
        download.className = 'file-sidebar-download';
        download.href = file.download_url || '#';
        download.title = '下载';
        download.setAttribute('aria-label', '下载 ' + (file.filename || ''));
        download.textContent = '⬇';
        item.appendChild(main);
        item.appendChild(download);
        const atTop = panel.scrollTop <= 2;
        const scrollBefore = panel.scrollTop;
        const heightBefore = panel.scrollHeight;
        list.insertBefore(item, list.firstElementChild);
        if (!atTop) {
            panel.scrollTop = scrollBefore + (panel.scrollHeight - heightBefore);
        }
        const count = panel.querySelector('[data-file-count]');
        if (count) {
            count.textContent = String(panel.querySelectorAll('.file-sidebar-item').length);
        }
    }
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
                case 'message_edited':
                    if (R.applyEdit) {
                        R.applyEdit(data.message_id, data.content, data.edited_at);
                    }
                    break;
                case 'message_pinned':
                    R.updatePinned(data.message_id, data.pinned, data.message);
                    break;
                case 'reaction':
                    R.applyReaction(data.message_id, data.emoji,
                                    data.user_id, data.added, data.count);
                    break;
                case 'batch_result':
                    if (window.MessageBatch) window.MessageBatch.done(data.count || 0);
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
                case 'discuss_file_added':
                    appendDiscussFile(data.file);
                    break;
                case 'kicked':
                    R.showToast('你已被移出「' + data.domain + '」');
                    setTimeout(function () { location.href = '/home'; }, 1500);
                    break;
                case 'domain_deleted':
                    R.showToast('「' + (data.name || '该域') + '」已被删除');
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
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.ChatRender.renderAllHistory());
    } else {
        window.ChatRender.renderAllHistory();
    }
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
            if (window.__chatLoadOlder) {
                window.__chatLoadOlder(true);
                const list = document.getElementById('messageList');
                if (list) list.scrollTop = -list.scrollHeight;
            }
            setTimeout(() => tryScroll(attempts - 1), 250);
        }
        setTimeout(() => tryScroll(30), 200);
    })();
    (function bindLoadOlder() {
        const list = document.getElementById('messageList');
        if (!list) return;
        let loading = false;
        let hasMoreOlder = list.dataset.hasMore !== 'false';
        let before = list.dataset.before || '';
        if (!before) hasMoreOlder = false;
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
            if (!urgent) showLoading();
            loading = true;
            const url = '/domain/' + encodeURIComponent(dn)
                + '/discuss/' + encodeURIComponent(disc)
                + '/messages?before=' + encodeURIComponent(before) + '&limit=50';
            const delay = urgent ? 0 : 500;
            setTimeout(() => {
                fetch(url).then((r) => r.json()).then((res) => {
                    if (!urgent) hideLoading();
                    loading = false;
                    if (!res.ok || !res.messages || !res.messages.length) {
                        hasMoreOlder = false;
                        return;
                    }
                    res.messages.slice().reverse().forEach((m) => {
                        if (window.ChatRender && window.ChatRender.prependMessage) {
                            window.ChatRender.prependMessage(m);
                        }
                    });
                    if (typeof window.__chatSearchReapply === 'function') {
                        window.__chatSearchReapply();
                    }
                    before = res.next_before
                        || (res.messages.length ? res.messages[0].id : before);
                    hasMoreOlder = !!res.has_more;
                }).catch(() => {
                    if (!urgent) hideLoading();
                    loading = false;
                });
            }, delay);
        }
        window.__chatLoadOlder = loadMore;
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Home') return;
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            e.preventDefault();
            if (!hasMoreOlder) {
                list.scrollTop = -list.scrollHeight;
                return;
            }
            const loadAllOlder = () => {
                if (!hasMoreOlder) {
                    list.scrollTop = -list.scrollHeight;
                    return;
                }
                loadMore();
                setTimeout(loadAllOlder, 600);
            };
            loadAllOlder();
        });
        list.addEventListener('scroll', function () {
            const distanceFromTop = -(list.scrollTop);
            const maxScroll = list.scrollHeight - list.clientHeight;
            if (maxScroll - distanceFromTop < 300) {
                loadMore();
            }
        }, { passive: true });
    })();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window.applyMemberPermissions);
    } else {
        window.applyMemberPermissions();
    }
})();

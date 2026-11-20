(function () {
    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const DOMAIN = window.__DOMAIN__ || '';
    const DISCUSS = window.__DISCUSS__ || '';
    if (!DOMAIN || !DISCUSS) return;
    if (!document.getElementById('messageList')) return;
    const wsUrl = `${WS_PROTOCOL}://${location.host}/ws/discuss/${DOMAIN}/${DISCUSS}`;
    let socket = null;
    let reconnectTimer = null;
    let lastMessageId = '';
    function newestMessageId() {
        const inner = document.querySelector('#messageList .message-list-inner')
            || document.getElementById('messageList');
        if (!inner) return '';
        const el = inner.querySelector('.message[data-id]');
        return el ? el.dataset.id : '';
    }
    function hasMessage(id) {
        if (!id) return false;
        return !!document.querySelector(
            '.message[data-id="' + CSS.escape(String(id)) + '"]');
    }
    function resyncMessages() {
        const R = window.ChatRender;
        if (!R) return;
        const anchor = lastMessageId || newestMessageId();
        const base = '/domain/' + encodeURIComponent(DOMAIN)
            + '/discuss/' + encodeURIComponent(DISCUSS) + '/messages';
        const added = [];
        const seen = new Set();
        let oldestAt = '';
        function finish() {
            if (oldestAt && lastMessageId === anchor) {
                let anchorGone = false;
                document.querySelectorAll('#messageList .message[data-id]')
                    .forEach(function (el) {
                        if (seen.has(el.dataset.id)) return;
                        const time = el.querySelector('.msg-time');
                        const at = time ? String(time.textContent || '') : '';
                        if (at && at >= oldestAt && R.applyDelete) {
                            if (el.dataset.id === anchor) anchorGone = true;
                            R.applyDelete(el.dataset.id);
                        }
                    });
                if (anchorGone) lastMessageId = newestMessageId();
            }
            if (!added.length) return;
            let newest = '';
            let newestAt = '';
            added.forEach(function (m) {
                const at = String(m.created_at || '');
                if (!newestAt || at >= newestAt) {
                    newestAt = at;
                    newest = m.id;
                }
            });
            if (lastMessageId === anchor && newest) lastMessageId = newest;
            const others = added.filter(function (m) {
                return m.user_id !== window.MY_UID && !m.revoked;
            });
            const atBottom = R.isAtBottom && R.isAtBottom();
            const editing = !!document.querySelector('.msg-edit-box');
            if (atBottom && !editing && !document.hidden) {
                if (R.scrollBottom) R.scrollBottom();
                if (window.markDiscussionRead) window.markDiscussionRead(true);
            } else if (others.length && R.showNewMsgBanner) {
                others.sort(function (a, b) {
                    return String(a.created_at || '')
                        .localeCompare(String(b.created_at || ''));
                });
                R.showNewMsgBanner(others.length, others[0].id);
            }
            if (typeof window.__chatSearchReapply === 'function') {
                window.__chatSearchReapply();
            }
        }
        window.ChatHistoryLoader.load({
            base: base,
            anchor: anchor,
            hasMessage: hasMessage,
            onSeen: function (m) {
                seen.add(m.id);
                const at = String(m.created_at || '');
                if (at && (!oldestAt || at < oldestAt)) oldestAt = at;
            },
            onExisting: function (m) {
                const el = document.querySelector(
                    '.message[data-id="' + CSS.escape(String(m.id)) + '"]');
                if (m.revoked && el && !el.classList.contains('revoked-msg')) {
                    R.applyRevoke({
                        message_id: m.id,
                        revoked_by: m.revoked_by,
                        revoked_by_nickname: m.revoked_by_nickname,
                        was_pinned: el.classList.contains('pinned'),
                    });
                } else if (!m.revoked && el) {
                    const bubble = el.querySelector('.msg-content');
                    if (bubble
                        && String(bubble.dataset.raw || '') !== String(m.content || '')) {
                        R.applyEdit(m.id, m.content, m.edited_at);
                    }
                    const pinned = !!m.pinned;
                    if (R.updatePinned
                        && pinned !== el.classList.contains('pinned')) {
                        R.updatePinned(m.id, pinned, pinned ? m : null);
                    }
                    const reactions = el.querySelector(
                        '.msg-reactions[data-reactions]');
                    const json = String(m.reactions_json || '{}');
                    if (reactions && R.preserveEditView && R.initReactionsIn
                        && reactions.dataset.reactions !== json) {
                        R.preserveEditView(function () {
                            reactions.dataset.reactions = json;
                            reactions.innerHTML = '';
                            delete reactions.dataset.rendered;
                            R.initReactionsIn(reactions);
                        });
                    }
                }
            },
            onNew: function (m) {
                R.appendMessage(m);
                added.push(m);
            },
            done: finish,
        });
    }
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
        if (window.MemberList) window.MemberList.apply(data);
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
            if (!lastMessageId) lastMessageId = newestMessageId();
            resyncMessages();
        };
        socket.onmessage = ev => {
            let data;
            try { data = JSON.parse(ev.data); } catch (e) { return; }
            const R = window.ChatRender;
            switch (data.type) {
                case 'new_message': {
                    const atBottom = R.isAtBottom();
                    const editing = !!document.querySelector('.msg-edit-box');
                    if (window.ChatSendQueue
                        && data.message.user_id === window.MY_UID) {
                        window.ChatSendQueue.ack(data.message);
                    }
                    if (hasMessage(data.message.id)) {
                        lastMessageId = data.message.id || lastMessageId;
                        break;
                    }
                    R.appendMessage(data.message);
                    lastMessageId = data.message.id || lastMessageId;
                    if (!atBottom || editing) {
                        if (window.MY_UID && data.message.user_id !== window.MY_UID) {
                            R.showNewMsgBanner(1, data.message.id);
                        }
                    } else if (R.scrollBottom) {
                        R.scrollBottom();
                    }
                    if (window.MY_UID && data.message.user_id !== window.MY_UID
                        && document.hidden && window.showDesktopNotification) {
                        const nick = data.message.nickname || '新消息';
                        window.showDesktopNotification({
                            title: nick,
                            content: Array.from(String(data.message.content || ''))
                                .slice(0, 80).join(''),
                            color: data.message.avatar_color || '#1890ff',
                            avatar: Array.from(nick)[0] || '?',
                            avatarUid: data.message.user_id,
                            avatarExt: data.message.avatar_ext || '',
                            tag: 'discuss-' + DOMAIN + '-' + DISCUSS,
                            onClick: function () {
                                if (window.scrollToMessage) {
                                    window.scrollToMessage(data.message.id);
                                } else {
                                    location.hash = '#msg-' + data.message.id;
                                }
                            },
                        });
                    }
                    if (typeof window.__chatSearchReapply === 'function') {
                        window.__chatSearchReapply();
                    }
                    if (atBottom && !editing && window.markDiscussionRead) {
                        window.markDiscussionRead(true);
                    }
                    break;
                }
                case 'message_deleted':
                    R.applyDelete(data.message_id);
                    break;
                case 'message_revoked':
                    R.applyRevoke(data);
                    break;
                case 'edit_ack':
                    if (R.applyEdit && data.content !== undefined) {
                        R.applyEdit(data.message_id, data.content, data.edited_at);
                    }
                    if (window.ChatEditQueue) window.ChatEditQueue.ack(data.edit_id);
                    break;
                case 'message_edited':
                    if (window.ChatEditQueue) window.ChatEditQueue.ack(data.message_id);
                    if (R.applyEdit) {
                        R.applyEdit(data.message_id, data.content, data.edited_at);
                    }
                    if (typeof window.__chatSearchReapply === 'function') {
                        window.__chatSearchReapply();
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
                    R.addDiscussionToSidebar(data.id, data.title, !!data.pinned);
                    break;
                case 'discussion_updated': {
                    if (data.old_id && data.old_id === window.__DISCUSS__) {
                        location.href = '/domain/' + encodeURIComponent(window.__DOMAIN__ || '')
                            + '/discuss/' + encodeURIComponent(data.id);
                        break;
                    }
                    R.updateDiscussionInSidebar(data.id, data.title, data.old_id, data.pinned);
                    if (data.id === window.__DISCUSS__) {
                        const title = document.querySelector('.discuss-header-title');
                        if (title) {
                            title.dataset.value = data.title || '';
                            title.textContent = data.title || '（无标题）';
                            title.classList.toggle('empty', !data.title);
                        }
                    }
                    break;
                }
                case 'discussion_deleted':
                    R.removeDiscussionFromSidebar(data.id);
                    if (data.id === window.__DISCUSS__) {
                        R.showToast('当前讨论已被删除');
                        setTimeout(function () {
                            location.href = '/domain/' + encodeURIComponent(window.__DOMAIN__ || '')
                                + '/discuss';
                        }, 1200);
                    }
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
                    if (window.ChatEditQueue) window.ChatEditQueue.fail();
                    if (window.ChatSendQueue) window.ChatSendQueue.restore();
                    R.showToast(data.msg);
                    break;
            }
        };
        socket.onclose = ev => {
            if (window.ChatEditQueue) window.ChatEditQueue.fail();
            if (ev && ev.code === 4001) {
                setTimeout(function () { location.href = '/home'; }, 1500);
                return;
            }
            if (ev && ev.code === 4003) return;
            reconnectTimer = setTimeout(connect, 3000);
        };
        socket.onerror = () => {};
    }
    connect();
    document.addEventListener('chat-inline-edit-closed', function () {
        if (!R.isAtBottom()) return;
        if (window.markDiscussionRead) window.markDiscussionRead(true);
        if (R.hideNewMsgBanner) R.hideNewMsgBanner();
    });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !R.isAtBottom()) return;
        if (window.markDiscussionRead) window.markDiscussionRead(true);
        if (R.hideNewMsgBanner) R.hideNewMsgBanner();
    });
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

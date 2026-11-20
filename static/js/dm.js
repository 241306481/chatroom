(function () {
    if (!window.MY_UID) return;
    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const wsUrl = `${WS_PROTOCOL}://${location.host}/ws/dm`;
    let socket = null;
    const onMessagesPage = !!document.getElementById('dmRoot');
    let _dmBannerCount = 0;
    let _dmBanner = null;
    let _dmBannerShownAt = 0;
    let _dmBannerGuardTimer = 0;
    let _dmBannerFirstEl = null;
    let _lastDmReadAt = 0;
    let lastDmId = '';
    function newestDmId() {
        const inner = document.querySelector('#dmList .dm-list-inner')
            || document.getElementById('dmList');
        if (!inner) return '';
        const el = inner.querySelector('.dm-msg[data-id]');
        return el ? el.dataset.id : '';
    }
    function hasDmMessage(id) {
        if (!id) return false;
        return !!document.querySelector(
            '.dm-msg[data-id="' + CSS.escape(String(id)) + '"]');
    }
    function setUnreadTotal(value) {
        const total = Math.max(0, parseInt(value, 10) || 0);
        document.querySelectorAll('a[href="/messages"]').forEach(function (a) {
            let badge = a.querySelector('.badge-unread');
            if (!total) {
                if (badge) badge.remove();
                return;
            }
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'badge-unread';
                a.appendChild(badge);
            }
            badge.textContent = String(total);
        });
    }
    function applyDMState(res) {
        setUnreadTotal(res.total);
        if (!onMessagesPage) return;
        (res.conversations || []).forEach(function (c) {
            const row = ensureConversationRow(c.other, {
                from: c.other,
                from_nickname: c.nickname,
                from_avatar_color: c.avatar_color,
                from_avatar_ext: c.avatar_ext,
            });
            if (!row) return;
            let badge = row.querySelector('.badge-unread');
            if (c.unread > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'badge-unread';
                    row.appendChild(badge);
                }
                badge.textContent = String(c.unread);
            } else if (badge) {
                badge.remove();
            }
        });
    }
    function syncDMState() {
        fetch('/messages/state', { headers: { 'Accept': 'application/json' } })
            .then(r => r.json()).then(applyDMState).catch(() => {});
    }
    function resyncDM() {
        syncDMState();
        if (!onMessagesPage) return;
        const target = document.body.dataset.dmTarget || '';
        if (!target) return;
        const anchor = lastDmId || newestDmId();
        const base = '/messages/' + encodeURIComponent(target) + '/history';
        const added = [];
        let before = '';
        let pages = 0;
        function finish() {
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
            if (lastDmId === anchor && newest) lastDmId = newest;
            const incoming = added.filter(function (m) {
                return !m.is_me && m.from !== window.MY_UID;
            });
            const atBottom = isDmAtBottom();
            const editing = !!document.querySelector('.msg-edit-box');
            if (atBottom && !editing && !document.hidden) {
                hideDmBanner();
                markCurrentDmRead(true);
                setTimeout(syncDMState, 300);
            } else if (incoming.length) {
                incoming.sort(function (a, b) {
                    return String(a.created_at || '')
                        .localeCompare(String(b.created_at || ''));
                });
                const id = incoming[0].id;
                const el = document.querySelector(
                    '.dm-msg[data-id="' + CSS.escape(String(id)) + '"]');
                showDmBanner(incoming.length, el);
            }
        }
        function loadPage() {
            const q = '?limit=100' + (before
                ? '&before=' + encodeURIComponent(before) : '');
            fetch(base + q, { headers: { 'Accept': 'application/json' } })
                .then(r => r.json()).then(function (res) {
                    if (!res || !res.ok || !Array.isArray(res.messages)) {
                        finish();
                        return;
                    }
                    const msgs = res.messages;
                    let found = !anchor;
                    msgs.forEach(function (m) {
                        if (!m || !m.id) return;
                        if (hasDmMessage(m.id)) {
                            if (m.id === anchor) found = true;
                            const el = document.querySelector(
                                '.dm-msg[data-id="' + CSS.escape(String(m.id)) + '"]');
                            const bubble = el && el.querySelector('.dm-bubble');
                            if (bubble
                                && String(bubble.dataset.raw || '') !== String(m.content || '')) {
                                applyDMEdit({
                                    message_id: m.id,
                                    content: m.content,
                                    edited_at: m.edited_at,
                                });
                            }
                            return;
                        }
                        if (appendDM(m, !!m.is_me)) added.push(m);
                    });
                    before = res.next_before
                        || (msgs[0] && msgs[0].id) || '';
                    pages++;
                    if (!found && res.has_more && before && pages < 10) {
                        loadPage();
                        return;
                    }
                    finish();
                }).catch(() => {});
        }
        loadPage();
    }
    function isDmAtBottom() {
        const l = document.getElementById('dmList');
        if (!l) return true;
        return Math.abs(l.scrollTop) <= 60;
    }
    function markCurrentDmRead(force) {
        if (!onMessagesPage || document.visibilityState !== 'visible') return;
        const target = document.body.dataset.dmTarget || '';
        if (!target || !socket || socket.readyState !== WebSocket.OPEN) return;
        const now = Date.now();
        if (!force && now - _lastDmReadAt < 1000) return;
        _lastDmReadAt = now;
        socket.send(JSON.stringify({ type: 'dm_read', target }));
        clearActiveBadge();
    }
    function ensureDmBanner() {
        if (_dmBanner && document.body.contains(_dmBanner)) return _dmBanner;
        const host = document.querySelector('.dm-input-area')
                  || document.querySelector('.dm-input-disabled')
                  || document.querySelector('.dm-main');
        if (!host) return null;
        _dmBanner = document.createElement('button');
        _dmBanner.type = 'button';
        _dmBanner.className = 'new-msg-banner';
        _dmBanner.hidden = true;
        _dmBanner.addEventListener('click', () => {
            const el = _dmBannerFirstEl;
            if (el && document.body.contains(el)) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('highlight');
                setTimeout(() => el.classList.remove('highlight'), 2000);
            }
            hideDmBanner();
            markCurrentDmRead();
        });
        host.appendChild(_dmBanner);
        return _dmBanner;
    }
    function showDmBanner(inc, firstEl) {
        const b = ensureDmBanner();
        if (!b) return;
        if (!_dmBannerFirstEl && firstEl) _dmBannerFirstEl = firstEl;
        _dmBannerCount += (inc || 1);
        _dmBannerShownAt = Date.now();
        b.innerHTML = '<span class="arrow">↓</span> ' + _dmBannerCount + ' 条新消息';
        b.hidden = false;
        clearTimeout(_dmBannerGuardTimer);
        _dmBannerGuardTimer = setTimeout(function () {
            if (isDmAtBottom()) hideDmBanner();
        }, 500);
    }
    function hideDmBanner() {
        _dmBannerCount = 0;
        _dmBannerFirstEl = null;
        clearTimeout(_dmBannerGuardTimer);
        if (_dmBanner) _dmBanner.hidden = true;
    }
    let _typingTimer = null;
    let _pendingDM = null;
    function showTyping(name) {
        const el = document.getElementById('dmTyping');
        if (!el) return;
        el.textContent = (name || '对方') + ' 正在输入…';
        el.hidden = false;
        if (_typingTimer) clearTimeout(_typingTimer);
        _typingTimer = setTimeout(() => { el.hidden = true; }, 3000);
    }
    function notifyIncomingDM(msg, target) {
        const nick = msg.from_nickname || ('用户 ' + target);
        window.showNotification({
            title: nick,
            content: Array.from(String(msg.content || '')).slice(0, 80).join(''),
            color: msg.from_avatar_color || '#1890ff',
            avatar: Array.from(nick)[0] || '?',
            avatarUid: msg.from,
            avatarExt: msg.from_avatar_ext || '',
            tag: 'dm-' + target,
            onClick: function () {
                location.href = '/messages?target=' + encodeURIComponent(target);
            },
        });
    }
    function ensureConversationRow(target, msg) {
        let row = document.querySelector(
            '.dm-conv[data-uid="' + CSS.escape(String(target)) + '"]');
        if (row || !onMessagesPage) return row;
        const aside = document.querySelector('.dm-sidebar');
        if (!aside) return null;
        const nick = (msg && msg.from_nickname) || String(target);
        const user = {
            id: (msg && msg.from) || target,
            nickname: nick,
            avatar_color: (msg && msg.from_avatar_color) || '#888',
            avatar_ext: (msg && msg.from_avatar_ext) || '',
        };
        row = document.createElement('a');
        row.className = 'dm-conv';
        row.href = '/messages?target=' + encodeURIComponent(target);
        row.dataset.uid = String(target);
        if (window.Avatar) {
            row.appendChild(window.Avatar.build(user, 'avatar-circle'));
        } else {
            const av = document.createElement('span');
            av.className = 'avatar-circle';
            av.style.background = user.avatar_color;
            av.textContent = nick[0] || '?';
            row.appendChild(av);
        }
        const name = document.createElement('span');
        name.className = 'dm-conv-nick';
        name.textContent = nick;
        row.appendChild(name);
        const empty = aside.querySelector('.empty');
        if (empty) empty.remove();
        const first = aside.querySelector('.dm-conv');
        if (first) aside.insertBefore(row, first);
        else aside.appendChild(row);
        return row;
    }
    function bumpConversationUnread(target, msg) {
        const row = ensureConversationRow(target, msg);
        if (!row) return;
        let badge = row.querySelector('.badge-unread');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'badge-unread';
            row.appendChild(badge);
        }
        badge.textContent = String(parseInt(badge.textContent || '0', 10) + 1);
    }
    function markDmRead() {
        const list = document.getElementById('dmList');
        if (!list) return;
        list.querySelectorAll('.dm-read-label').forEach(el => el.remove());
        const mine = list.querySelector('.dm-me');
        if (!mine) return;
        const header = mine.querySelector('.dm-msg-header');
        if (!header) return;
        const label = document.createElement('span');
        label.className = 'dm-read-label';
        label.textContent = '已读';
        header.appendChild(label);
    }
    function bindDmBottomWatcher() {
        const l = document.getElementById('dmList');
        if (!l || l._dmBannerBound) return;
        l._dmBannerBound = true;
        l.addEventListener('scroll', () => {
            if (isDmAtBottom() && Date.now() - _dmBannerShownAt > 500) {
                hideDmBanner();
                markCurrentDmRead();
            }
        }, { passive: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindDmBottomWatcher);
    } else {
        bindDmBottomWatcher();
    }
    function connect() {
        socket = new WebSocket(wsUrl);
        socket.onopen = () => resyncDM();
        socket.onmessage = ev => {
            const data = JSON.parse(ev.data);
            if (data.type === 'dm_new') {
                const t = data.message.from;
                const cur = document.body.dataset.dmTarget || '';
                const isViewing = onMessagesPage && t === cur;
                if (isViewing) {
                    const wasAtBottom = isDmAtBottom();
                    const editing = !!document.querySelector('.msg-edit-box');
                    const el = appendDM(data.message, false);
                    lastDmId = data.message.id || lastDmId;
                    if (document.hidden) {
                        notifyIncomingDM(data.message, t);
                        if (!wasAtBottom || editing) showDmBanner(1, el);
                    } else if (wasAtBottom && !editing) {
                        markCurrentDmRead(true);
                        hideDmBanner();
                    } else {
                        showDmBanner(1, el);
                    }
                } else {
                    window.bumpUnreadBadge();
                    if (onMessagesPage) bumpConversationUnread(t, data.message);
                    notifyIncomingDM(data.message, t);
                }
            } else if (data.type === 'dm_sent') {
                const t = data.message.to;
                const cur = document.body.dataset.dmTarget || '';
                if (_pendingDM && _pendingDM.target === String(t)
                    && _pendingDM.content === data.message.content) {
                    _pendingDM = null;
                }
                if (onMessagesPage && t === cur) {
                    appendDM(data.message, true);
                    lastDmId = data.message.id || lastDmId;
                }
            } else if (data.type === 'edit_ack') {
                if (data.content !== undefined) applyDMEdit(data);
                if (window.ChatEditQueue) window.ChatEditQueue.ack(data.edit_id);
            } else if (data.type === 'dm_edited') {
                if (window.ChatEditQueue) window.ChatEditQueue.ack(data.message_id);
                applyDMEdit(data);
            } else if (data.type === 'dm_typing') {
                const cur = document.body.dataset.dmTarget || '';
                if (onMessagesPage && data.from === cur) showTyping(data.from_nickname);
            } else if (data.type === 'dm_read') {
                const cur = document.body.dataset.dmTarget || '';
                if (onMessagesPage && data.by === cur) markDmRead();
            } else if (data.type === 'kicked') {
                if (window.showToast) window.showToast('你已被禁止访问');
                setTimeout(function () { location.href = '/home'; }, 1500);
            } else if (data.type === 'error') {
                if (window.ChatEditQueue) window.ChatEditQueue.fail();
                if (_pendingDM) {
                    const cur = document.body.dataset.dmTarget || '';
                    const ta = document.getElementById('dmInput');
                    if (ta && _pendingDM.target === cur && !ta.value.trim()) {
                        ta.value = _pendingDM.content;
                        ta.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    _pendingDM = null;
                }
                if (window.showToast) window.showToast(data.msg);
            }
        };
        socket.onclose = ev => {
            if (window.ChatEditQueue) window.ChatEditQueue.fail();
            if (ev && ev.code === 4001) {
                setTimeout(function () { location.href = '/home'; }, 1500);
                return;
            }
            if (ev && ev.code === 4003) return;
            setTimeout(connect, 3000);
        };
        socket.onerror = () => {};
    }
    connect();
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !onMessagesPage) return;
        if (!isDmAtBottom()) return;
        hideDmBanner();
        markCurrentDmRead(true);
    });
    document.addEventListener('chat-inline-edit-closed', function () {
        if (!onMessagesPage || !isDmAtBottom()) return;
        hideDmBanner();
        markCurrentDmRead(true);
    });
    let _typingSentAt = 0;
    document.addEventListener('input', function (e) {
        if (!onMessagesPage || !e.target || e.target.id !== 'dmInput') return;
        const target = document.body.dataset.dmTarget || '';
        if (!target || !e.target.value.trim()) return;
        const now = Date.now();
        if (now - _typingSentAt < 2000) return;
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        _typingSentAt = now;
        socket.send(JSON.stringify({ type: 'dm_typing', target }));
    });
    window.sendDM = function () {
        const ta = document.getElementById('dmInput');
        const target = document.body.dataset.dmTarget;
        if (!ta || !target) return;
        const content = ta.value.trim();
        if (!content || !socket || socket.readyState !== WebSocket.OPEN) return;
        _pendingDM = { target: String(target), content, at: Date.now() };
        socket.send(JSON.stringify({ type: 'dm_send', target, content }));
        ta.value = '';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    window.editDMMessage = function (id, btn) {
        const root = btn && btn.closest ? btn.closest('.dm-msg') : null;
        if (!root) return;
        const bubble = root.querySelector('.dm-bubble');
        const target = document.body.dataset.dmTarget || '';
        if (!bubble || !target || !window.ChatRender
            || !window.ChatRender.startInlineEdit) return;
        window.ChatRender.startInlineEdit(root, bubble, function (val, settle, reqId) {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                window.showToast('未就绪');
                settle(false);
                return;
            }
            socket.send(JSON.stringify({
                type: 'dm_edit', target, message_id: id, content: val,
                edit_id: reqId,
            }));
        }, id);
    };
    function applyDMEdit(data) {
        const preserve = window.ChatRender && window.ChatRender.preserveEditView;
        if (preserve) {
            preserve(function () { applyDMEditDom(data); });
            return;
        }
        applyDMEditDom(data);
    }
    function applyDMEditDom(data) {
        const el = document.querySelector(
            '.dm-msg[data-id="' + CSS.escape(data.message_id) + '"]');
        if (!el) return;
        const bubble = el.querySelector('.dm-bubble');
        if (!bubble) return;
        bubble.dataset.raw = data.content;
        bubble.innerHTML = window.renderContent(data.content);
        bubble.dataset.rendered = '1';
        bubble.removeAttribute('data-mode');
        const copyBtn = bubble.querySelector('.source-copy-btn');
        if (copyBtn) copyBtn.remove();
        let mark = el.querySelector('.dm-edited');
        if (!mark) {
            mark = document.createElement('button');
            mark.type = 'button';
            mark.className = 'dm-edited';
            mark.textContent = '已编辑';
            mark.dataset.action = 'show-message-history';
            mark.dataset.id = data.message_id;
            const time = el.querySelector('.dm-time');
            if (time && time.parentNode) time.parentNode.insertBefore(mark, time.nextSibling);
            else el.querySelector('.dm-msg-header').appendChild(mark);
        }
        mark.title = data.edited_at || '';
        if (window.CollapseUI && window.CollapseUI.refreshMessage) {
            window.CollapseUI.refreshMessage(el);
        }
    }
    function renderDMUserList(items) {
        const list = document.getElementById('dmSearchList');
        if (!list) return;
        list.innerHTML = '';
        if (!items.length) {
            list.innerHTML = '<div class="dm-search-empty">未找到用户</div>';
            return;
        }
        items.forEach(u => {
            const a = document.createElement('a');
            a.className = 'dm-search-item';
            a.href = '/messages?target=' + encodeURIComponent(u.id);
            const av = window.Avatar
                ? window.Avatar.build(u, 'avatar-circle')
                : (function () {
                    const s = document.createElement('span');
                    s.className = 'avatar-circle';
                    s.style.background = u.avatar_color || '#888';
                    s.textContent = (u.nickname || '?')[0];
                    return s;
                })();
            const nick = document.createElement('span');
            nick.textContent = u.nickname || '?';
            const uid = document.createElement('span');
            uid.className = 'dm-search-uid';
            uid.textContent = 'UID ' + u.id;
            a.appendChild(av);
            a.appendChild(nick);
            a.appendChild(uid);
            list.appendChild(a);
        });
    }
    let dmSearchTimer = null;
    let dmSearchSeq = 0;
    function searchDMUsers(query) {
        const list = document.getElementById('dmSearchList');
        if (!list) return;
        const q = String(query || '').trim();
        if (!q) {
            list.innerHTML = '<div class="dm-search-empty">输入昵称或 UID 搜索</div>';
            return;
        }
        const seq = ++dmSearchSeq;
        list.innerHTML = '<div class="dm-search-empty">搜索中…</div>';
        fetch('/messages/users?q=' + encodeURIComponent(q), {
            headers: { 'Accept': 'application/json' },
        }).then(r => r.json()).then(res => {
            if (seq !== dmSearchSeq) return;
            if (!res.ok) throw new Error(res.error || '搜索失败');
            renderDMUserList(Array.isArray(res.users) ? res.users : []);
        }).catch(() => {
            if (seq !== dmSearchSeq) return;
            list.innerHTML = '<div class="dm-search-empty">搜索失败，请重试</div>';
        });
    }
    window.newDMTarget = function () {
        const picker = document.getElementById('dmNewPicker');
        const input = document.getElementById('dmSearchInput');
        if (!picker || !input) return;
        const open = picker.hidden;
        picker.hidden = !open;
        if (open) {
            input.value = '';
            searchDMUsers('');
            input.focus();
        }
    };
    document.addEventListener('input', function (e) {
        if (!e.target || e.target.id !== 'dmSearchInput') return;
        clearTimeout(dmSearchTimer);
        dmSearchTimer = setTimeout(() => searchDMUsers(e.target.value), 200);
    });
    window.submitDMPolicy = function (form) {
        const data = new URLSearchParams(new FormData(form)).toString();
        const action = form.getAttribute('action');
        fetch(action ? new URL(action, location.href).href : location.href, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: data,
        }).then(r => r.json()).then(res => {
            window.showAlert(res.ok ? '已保存' : (res.error || '保存失败'), { title: '私信设置' });
        }).catch(() => window.showAlert('网络错误', { title: '私信设置' }));
        return false;
    };
function appendDM(msg, isMe) {
        const list = document.getElementById('dmList');
        if (!list) return null;
        const inner = list.querySelector('.dm-list-inner') || list;
        const existing = msg && msg.id ? inner.querySelector(
            '.dm-msg[data-id="' + CSS.escape(String(msg.id)) + '"]') : null;
        if (existing) return existing;
        const wasAtBottom = Math.abs(list.scrollTop) <= 60;
        const editBox = inner.querySelector('.msg-edit-box');
        const editTop = editBox ? editBox.getBoundingClientRect().top : 0;
        const div = window.ChatRender && window.ChatRender.buildDMMessageEl
            ? window.ChatRender.buildDMMessageEl(Object.assign({}, msg, { is_me: !!isMe }))
            : null;
        if (!div) return null;
        inner.insertBefore(div, inner.firstElementChild);
        if (editBox) {
            const delta = editBox.getBoundingClientRect().top - editTop;
            if (delta) list.scrollTop += delta;
        } else if (wasAtBottom) {
            list.scrollTop = 0;
        }
        return div;
    }
    (function bindDmLoadOlder() {
        const list = document.getElementById('dmList');
        const target = document.body.dataset.dmTarget || '';
        if (!list || !target) return;
        let loading = false;
        let hasMore = list.dataset.hasMore !== 'false';
        let before = list.dataset.before || '';
        if (!before) hasMore = false;
        function showLoading() {
            const inner = list.querySelector('.dm-list-inner') || list;
            if (inner.querySelector('.loading-older')) return;
            const el = document.createElement('div');
            el.className = 'loading-older';
            el.textContent = '正在加载更早的消息…';
            inner.appendChild(el);
        }
        function hideLoading() {
            const inner = list.querySelector('.dm-list-inner') || list;
            const el = inner.querySelector('.loading-older');
            if (el) el.remove();
        }
        function loadMore(urgent) {
            if (loading || !hasMore || !before) return;
            loading = true;
            if (!urgent) showLoading();
            const prevHeight = list.scrollHeight;
            const prevTop = list.scrollTop;
            const url = '/messages/' + encodeURIComponent(target)
                + '/history?before=' + encodeURIComponent(before) + '&limit=50';
            const delay = urgent ? 0 : 400;
            setTimeout(() => {
                fetch(url, { headers: { 'Accept': 'application/json' } })
                    .then(r => r.json()).then(res => {
                        hideLoading();
                        loading = false;
                        if (!res.ok || !res.messages || !res.messages.length) {
                            hasMore = false;
                            return;
                        }
                        const inner = list.querySelector('.dm-list-inner') || list;
                        const olderEditBox = inner.querySelector('.msg-edit-box');
                        const olderEditTop = olderEditBox
                            ? olderEditBox.getBoundingClientRect().top : 0;
                        res.messages.slice().reverse().forEach(m => {
                            const div = window.ChatRender
                                && window.ChatRender.buildDMMessageEl
                                ? window.ChatRender.buildDMMessageEl(
                                    Object.assign({}, m, { is_me: !!m.is_me }))
                                : null;
                            if (div) inner.appendChild(div);
                        });
                        if (olderEditBox) {
                            const delta = olderEditBox.getBoundingClientRect().top
                                - olderEditTop;
                            if (delta) list.scrollTop += delta;
                        }
                        before = res.next_before || before;
                        hasMore = !!res.has_more;
                        const grew = list.scrollHeight - prevHeight;
                        if (!olderEditBox && grew > 0) list.scrollTop = prevTop - grew;
                    }).catch(() => {
                        hideLoading();
                        loading = false;
                    });
            }, delay);
        }
        window.__dmLoadOlder = loadMore;
        list.addEventListener('scroll', function () {
            const distanceFromTop = -(list.scrollTop);
            const maxScroll = list.scrollHeight - list.clientHeight;
            if (maxScroll - distanceFromTop < 300) loadMore();
        }, { passive: true });
    })();
    const ta = document.getElementById('dmInput');
    if (ta) ta.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'Enter') sendDM();
    });
    function renderHistory() {
        document.querySelectorAll('.dm-bubble[data-raw]').forEach(function (el) {
            if (el.dataset.rendered === '1') return;
            el.innerHTML = window.renderContent(el.dataset.raw || '');
            el.dataset.rendered = '1';
        });
    }
    function clearActiveBadge() {
        var active = document.querySelector('.dm-conv.active');
        if (!active) return;
        var badge = active.querySelector('.badge-unread');
        if (badge) badge.remove();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { renderHistory(); clearActiveBadge(); });
    } else { renderHistory(); clearActiveBadge(); }
})();

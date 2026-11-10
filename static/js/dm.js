(function () {
    if (!window.MY_UID) return;
    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const wsUrl = `${WS_PROTOCOL}://${location.host}/ws/dm`;
    let socket = null, reconnectTimer = null;
    const onMessagesPage = !!document.getElementById('dmRoot');
    let _dmBannerCount = 0;
    let _dmBanner = null;
    function isDmAtBottom() {
        const l = document.getElementById('dmList');
        if (!l) return true;
        return Math.abs(l.scrollTop) <= 60;
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
            const l = document.getElementById('dmList');
            if (l) l.scrollTop = 0;
            hideDmBanner();
        });
        host.appendChild(_dmBanner);
        return _dmBanner;
    }
    function showDmBanner(inc) {
        const b = ensureDmBanner();
        if (!b) return;
        _dmBannerCount += (inc || 1);
        b.innerHTML = '<span class="arrow">↓</span> ' + _dmBannerCount + ' 条新消息';
        b.hidden = false;
    }
    function hideDmBanner() {
        _dmBannerCount = 0;
        if (_dmBanner) _dmBanner.hidden = true;
    }
    let _typingTimer = null;
    function showTyping(name) {
        const el = document.getElementById('dmTyping');
        if (!el) return;
        el.textContent = (name || '对方') + ' 正在输入…';
        el.hidden = false;
        if (_typingTimer) clearTimeout(_typingTimer);
        _typingTimer = setTimeout(() => { el.hidden = true; }, 3000);
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
            if (isDmAtBottom()) hideDmBanner();
        }, { passive: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindDmBottomWatcher);
    } else {
        bindDmBottomWatcher();
    }
    function connect() {
        socket = new WebSocket(wsUrl);
        socket.onmessage = ev => {
            const data = JSON.parse(ev.data);
            if (data.type === 'dm_new') {
                const t = data.message.from;
                const cur = document.body.dataset.dmTarget || '';
                const isViewing = onMessagesPage && t === cur;
                if (isViewing) {
                    appendDM(data.message, false);
                    socket.send(JSON.stringify({ type: 'dm_read', target: t }));
                    if (!isDmAtBottom()) showDmBanner(1);
                } else {
                    if (!onMessagesPage) window.bumpUnreadBadge();
                    var nick = data.message.from_nickname || ('用户 ' + t);
                    window.showNotification({
                        title: nick,
                        content: Array.from(String(data.message.content || '')).slice(0, 80).join(''),
                        color: data.message.from_avatar_color || '#1890ff',
                        avatar: Array.from(nick)[0] || '?',
                        avatarUid: data.message.from,
                        avatarExt: data.message.from_avatar_ext || '',
                        tag: 'dm-' + t,
                        onClick: function () { location.href = '/messages?target=' + t; },
                    });
                }
            } else if (data.type === 'dm_sent') {
                const t = data.message.to;
                const cur = document.body.dataset.dmTarget || '';
                if (onMessagesPage && t === cur) appendDM(data.message, true);
            } else if (data.type === 'dm_edited') {
                applyDMEdit(data);
            } else if (data.type === 'dm_typing') {
                const cur = document.body.dataset.dmTarget || '';
                if (onMessagesPage && data.from === cur) showTyping(data.from_nickname);
            } else if (data.type === 'dm_read') {
                const cur = document.body.dataset.dmTarget || '';
                if (onMessagesPage && data.by === cur) markDmRead();
            }
        };
        socket.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
        socket.onerror = () => {};
    }
    connect();
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
        window.ChatRender.startInlineEdit(root, bubble, function (val, close) {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                window.showToast('未就绪');
                close();
                return;
            }
            socket.send(JSON.stringify({
                type: 'dm_edit', target, message_id: id, content: val,
            }));
            close();
        });
    };
    function applyDMEdit(data) {
        const el = document.querySelector(
            '.dm-msg[data-id="' + CSS.escape(data.message_id) + '"]');
        if (!el) return;
        const bubble = el.querySelector('.dm-bubble');
        if (!bubble) return;
        bubble.dataset.raw = data.content;
        bubble.innerHTML = window.renderContent(data.content);
        bubble.dataset.rendered = '1';
        let mark = el.querySelector('.dm-edited');
        if (!mark) {
            mark = document.createElement('span');
            mark.className = 'dm-edited';
            mark.textContent = '已编辑';
            const time = el.querySelector('.dm-time');
            if (time && time.parentNode) time.parentNode.insertBefore(mark, time.nextSibling);
            else el.querySelector('.dm-msg-header').appendChild(mark);
        }
        mark.title = data.edited_at || '';
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
        fetch(form.action, {
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
        if (!list) return;
        const inner = list.querySelector('.dm-list-inner') || list;
        const wasAtBottom = Math.abs(list.scrollTop) <= 60;
        const div = window.ChatRender && window.ChatRender.buildDMMessageEl
            ? window.ChatRender.buildDMMessageEl(Object.assign({}, msg, { is_me: !!isMe }))
            : null;
        if (!div) return;
        inner.insertBefore(div, inner.firstElementChild);
        if (wasAtBottom) {
            list.scrollTop = 0;
        }
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
                        res.messages.slice().reverse().forEach(m => {
                            const div = window.ChatRender
                                && window.ChatRender.buildDMMessageEl
                                ? window.ChatRender.buildDMMessageEl(
                                    Object.assign({}, m, { is_me: !!m.is_me }))
                                : null;
                            if (div) inner.appendChild(div);
                        });
                        before = res.next_before || before;
                        hasMore = !!res.has_more;
                        const grew = list.scrollHeight - prevHeight;
                        if (grew > 0) list.scrollTop = prevTop - grew;
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

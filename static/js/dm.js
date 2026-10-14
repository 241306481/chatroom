// ============================================================
// 私信 WebSocket（含通知）
// ============================================================
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
        // column-reverse：scrollTop = 0 是底部，向上滚为负值
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
                        onClick: function () { location.href = '/messages?target=' + t; },
                    });
                }
            } else if (data.type === 'dm_sent') {
                const t = data.message.to;
                const cur = document.body.dataset.dmTarget || '';
                if (onMessagesPage && t === cur) appendDM(data.message, true);
            }
        };
        socket.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
        socket.onerror = () => {};
    }
    connect();

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

    window.newDMTarget = function () {
        const picker = document.getElementById('dmNewPicker');
        const input = document.getElementById('dmSearchInput');
        const list = document.getElementById('dmSearchList');
        if (!picker || !input || !list) return;

        const users = window.__DM_USERS__ || [];

        function renderList(query) {
            const q = (query || '').toLowerCase().trim();
            let items = users;
            if (q) {
                items = users.filter(u =>
                    String(u.nickname || '').toLowerCase().indexOf(q) >= 0
                    || String(u.id).indexOf(q) >= 0
                );
            }
            items = items.slice(0, 20);
            list.innerHTML = '';
            if (!items.length) {
                list.innerHTML = '<div class="dm-search-empty">未找到用户</div>';
                return;
            }
            items.forEach(u => {
                const a = document.createElement('a');
                a.className = 'dm-search-item';
                a.href = '/messages?target=' + encodeURIComponent(u.id);

                const av = document.createElement('span');
                av.className = 'avatar-circle';
                // 颜色走 style 属性接口，不做字符串拼接：
                // 昵称/颜色是用户可控的，拼进 style="..." 就能用 " 闭合属性
                av.style.background = u.avatar_color || '#888';
                av.textContent = (u.nickname || '?')[0];

                const nick = document.createElement('span');
                // 昵称允许 < > " 等字符（validateNickname 只挡保留词/数字开头/
                // 控制字符/反斜杠），必须用 textContent，不能拼 innerHTML
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

        const open = picker.hidden;
        picker.hidden = !open;
        if (open) {
            input.value = '';
            renderList('');
            input.focus();
        }
    };

    // 输入筛选
    document.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'dmSearchInput') {
            const users = window.__DM_USERS__ || [];
            const q = e.target.value.toLowerCase().trim();
            let items = users;
            if (q) {
                items = users.filter(u =>
                    String(u.nickname || '').toLowerCase().indexOf(q) >= 0
                    || String(u.id).indexOf(q) >= 0
                );
            }
            items = items.slice(0, 20);
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

                const av = document.createElement('span');
                av.className = 'avatar-circle';
                av.style.background = u.avatar_color || '#888';
                av.textContent = (u.nickname || '?')[0];

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

        // 插入前先取：用户是否本来看在底部（column-reverse：scrollTop 接近 0）
        const wasAtBottom = Math.abs(list.scrollTop) <= 60;

        const div = window.ChatRender && window.ChatRender.buildDMMessageEl
            ? window.ChatRender.buildDMMessageEl(Object.assign({}, msg, { is_me: !!isMe }))
            : null;
        if (!div) return;
        // column-reverse：插到 DOM 开头 = 视觉底部
        inner.insertBefore(div, inner.firstElementChild);

        // 仅当用户本来就在底部时才置底；否则保持视口位置，让 banner 提示
        if (wasAtBottom) {
            list.scrollTop = 0;
        }
    }
    const ta = document.getElementById('dmInput');
    if (ta) ta.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'Enter') sendDM();
    });
    // 页面初始化：渲染历史气泡 + 清除当前会话未读
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
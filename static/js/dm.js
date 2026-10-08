// ============================================================
// 私信 WebSocket（含通知）
// ============================================================
(function () {
    if (!window.MY_UID) return;
    const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
    const wsUrl = `${WS_PROTOCOL}://${location.host}/ws/dm`;
    let socket = null, reconnectTimer = null;
    const onMessagesPage = !!document.getElementById('dmRoot');

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
                } else {
                    if (!onMessagesPage) window.bumpUnreadBadge();
                    window.showNotification({
                        title: data.message.from_nickname || ('用户 ' + t),
                        content: Array.from(String(data.message.content || '')).slice(0, 80).join(''),
                        color: '#1890ff',
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
        window.showPrompt('输入对方 UID', '', { title: '新增会话' }).then(function (uid) {
            if (uid && uid.trim()) location.href = '/messages?target=' + encodeURIComponent(uid.trim());
        });
    };

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
        const div = document.createElement('div');
        div.className = 'dm-msg ' + (isMe ? 'dm-me' : 'dm-other');
        const contentHtml = window.renderContent ? window.renderContent(msg.content) : esc(msg.content);
        div.innerHTML = '<div class="dm-bubble">' + contentHtml + '</div>' +
            '<div class="dm-time">' + esc(msg.created_at) + '</div>';
        list.appendChild(div);
        list.scrollTop = list.scrollHeight;
    }
    const ta = document.getElementById('dmInput');
    if (ta) ta.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'Enter') sendDM();
    });
    const list = document.getElementById('dmList');
    if (list) list.scrollTop = list.scrollHeight;

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
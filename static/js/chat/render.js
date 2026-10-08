// ============================================================
// 消息 DOM 渲染 + 表情渲染 + 讨论侧栏
// ============================================================
(function () {

    // ---------- 讨论侧栏 ----------
    function addDiscussionToSidebar(id, title) {
        const sidebar = document.querySelector('.sidebar-discussions');
        if (!sidebar) return;
        if (sidebar.querySelector('a[href$="/discuss/' + id + '"]')) return;
        const DOMAIN = window.__DOMAIN__ || '';
        const a = document.createElement('a');
        a.href = '/domain/' + encodeURIComponent(DOMAIN) + '/discuss/' + id;
        a.className = 'disc-item';
        a.innerHTML = '<span class="disc-item-id">#' + esc(id) + '</span>'
            + (title ? '<span class="disc-item-title">' + esc(title) + '</span>' : '');
        sidebar.appendChild(a);
    }

    function removeDiscussionFromSidebar(id) {
        const sidebar = document.querySelector('.sidebar-discussions');
        if (!sidebar) return;
        const a = sidebar.querySelector('a[href$="/discuss/' + id + '"]');
        if (a) a.remove();
    }

    // ---------- 追加 / 移除消息 ----------
    function appendMessage(msg) {
        const list = document.getElementById('messageList');
        if (!list) return;

        const empty = list.querySelector('.empty');
        if (empty) empty.remove();

        const div = document.createElement('div');
        div.className = 'message';
        if (msg.is_system) div.classList.add('system-msg');
        div.dataset.id = msg.id;

        const canPin = window.__CAN_PIN__ === true;
        const canDeleteAny = window.__CAN_DELETE_ANY__ === true;
        const canAddReaction = window.__CAN_ADD_REACTION__ === true;
        const isOwn = msg.user_id === window.MY_UID;
        const showPin = canPin;
        const showDelete = canDeleteAny || isOwn;

        const canReply = !!document.getElementById('msgInput');
        const replyBtn = canReply
            ? `<button type="button" class="msg-reply-btn" onclick="setReplyTo('${msg.id}', this)" title="回复">↩️</button>`
            : '';
        const replyQuote = msg.reply_info
            ? `<div class="msg-reply-quote" onclick="scrollToMessage('${msg.reply_info.id}')">
                   <span class="reply-quote-nick">${esc(msg.reply_info.nickname)}</span>
                   <span class="reply-quote-content">${esc(msg.reply_info.content)}</span>
               </div>`
            : '';

        div.innerHTML = `
            <div class="msg-avatar" style="background:${msg.avatar_color || '#888'}">${(msg.nickname || '?')[0]}</div>
            <div class="msg-body">
                <div class="msg-header">
                    <span class="msg-nick">${esc(msg.nickname)}</span>
                    <span class="msg-time">${esc(msg.created_at)}</span>
                    ${replyBtn}
                    <div class="msg-actions">
                        <button type="button" onclick="toggleSource(this)" title="查看源码">📄</button>
                        ${canAddReaction ? `<button type="button" onclick="toggleReactionPicker('${msg.id}', this)" title="添加表情">😀</button>` : ''}
                        ${showPin ? `<button type="button" onclick="pinMessage('${msg.id}')" title="置顶">📌</button>` : ''}
                        ${showDelete ? `<button type="button" onclick="deleteMessage('${msg.id}')" title="删除">🗑</button>` : ''}
                    </div>
                </div>
                ${replyQuote}
                <div class="msg-content" data-raw="${escAttr(msg.content)}">${window.renderContent(msg.content)}</div>
                <div class="msg-reactions" id="reactions-${msg.id}"></div>
            </div>`;
        list.appendChild(div);
    }

    function removeMessage(id) {
        const el = document.querySelector(`.message[data-id="${id}"]`);
        if (el) el.remove();
    }

    // ---------- 置顶 ----------
    function updatePinned(id, pinned, msg) {
        const el = document.querySelector(`.message[data-id="${id}"]`);
        if (el) {
            el.classList.toggle('pinned', pinned);
            const h = el.querySelector('.msg-header');
            if (pinned && h && !h.querySelector('.pin-icon')) {
                const i = document.createElement('span');
                i.className = 'pin-icon';
                i.textContent = '📌';
                h.prepend(i);
            } else if (!pinned) {
                const i = el.querySelector('.pin-icon');
                if (i) i.remove();
            }
        }
        updatePinnedPanel(id, pinned, msg);
    }

    function updatePinnedPanel(id, pinned, msg) {
        const panel = document.querySelector('.pinned-panel');
        if (!panel) return;

        if (!pinned) {
            const item = panel.querySelector('.pinned-item[data-id="' + id + '"]');
            if (item) item.remove();
            if (!panel.querySelector('.pinned-item')) {
                let empty = panel.querySelector('.empty');
                if (!empty) {
                    empty = document.createElement('p');
                    empty.className = 'empty';
                    empty.textContent = '暂无公告';
                    panel.appendChild(empty);
                }
            }
            return;
        }

        const empty = panel.querySelector('.empty');
        if (empty) empty.remove();

        let item = panel.querySelector('.pinned-item[data-id="' + id + '"]');
        if (!item) {
            item = document.createElement('div');
            item.dataset.id = id;
            panel.appendChild(item);
        }
        item.className = 'pinned-item' + (msg && msg.is_system ? ' system-pin' : '');
        const canPin = window.__CAN_PIN__ === true;
        item.innerHTML =
            '<div class="pinned-content">' + esc(msg ? msg.content : '') + '</div>' +
            '<div class="pinned-meta">' + esc(msg ? msg.nickname : '') + '</div>' +
            (canPin
                ? '<div class="pinned-actions"><button type="button" title="取消置顶" onclick="unpinMessage(\'' + id + '\')">📌</button></div>'
                : '');
    }

    // ---------- 表情 ----------
    function renderReaction(container, msgId, emoji, count, mine) {
        let b = container.querySelector('[data-emoji="' + CSS.escape(emoji) + '"]');
        if (count <= 0) { if (b) b.remove(); return; }

        if (!b) {
            b = document.createElement('button');
            b.type = 'button';
            b.className = 'reaction-btn';
            b.dataset.emoji = emoji;
            b.innerHTML = '<span class="reaction-emoji"></span><span class="count"></span>';
            b.addEventListener('click', function () {
                window.sendReaction(msgId, emoji);
            });
            container.appendChild(b);
        }
        b.classList.toggle('mine', !!mine);
        b.querySelector('.reaction-emoji').textContent = emoji;
        b.querySelector('.count').textContent = String(count);
    }

    function applyReaction(msgId, emoji, userId, added, count) {
        const c = document.getElementById('reactions-' + msgId);
        if (!c) return;
        const existing = c.querySelector('[data-emoji="' + CSS.escape(emoji) + '"]');
        let mine = existing ? existing.classList.contains('mine') : false;
        if (userId === window.MY_UID) mine = !!added;
        renderReaction(c, msgId, emoji, count, mine);
    }

    // ---------- 历史渲染 ----------
    function renderAllHistory() {
        document.querySelectorAll('.msg-content[data-raw]').forEach(function (el) {
            if (el.dataset.rendered === '1') return;
            el.innerHTML = window.renderContent(el.dataset.raw || '');
            el.dataset.rendered = '1';
        });
    }

    // ---------- 初始化历史表情 ----------
    function initReactions() {
        document.querySelectorAll('.msg-reactions[data-reactions]').forEach(function (el) {
            if (el.dataset.rendered === '1') return;
            let obj = {};
            try { obj = JSON.parse(el.dataset.reactions || '{}'); } catch (e) {}
            const msgId = el.id.replace('reactions-', '');
            Object.keys(obj).forEach(function (key) {
                const emoji = key.substring(2);
                const uids = Array.isArray(obj[key]) ? obj[key] : [];
                renderReaction(el, msgId, emoji, uids.length, uids.indexOf(window.MY_UID) >= 0);
            });
            el.dataset.rendered = '1';
        });
    }

    // ---------- 工具 ----------
    function scrollBottom() {
        const l = document.getElementById('messageList');
        if (l) l.scrollTop = l.scrollHeight;
    }

    function showToast(m) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = m;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // ---------- 导出 ----------
    window.ChatRender = {
        addDiscussionToSidebar,
        removeDiscussionFromSidebar,
        appendMessage,
        removeMessage,
        updatePinned,
        updatePinnedPanel,
        renderReaction,
        applyReaction,
        renderAllHistory,
        initReactions,
        scrollBottom,
        showToast,
    };
})();
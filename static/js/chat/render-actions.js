(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function revokeMessage(id) {
        window.showConfirm('撤回这条消息？').then(function (ok) {
            if (!ok) return;
            if (window.ChatWS && window.ChatWS.isOpen()) {
                window.ChatWS.send({ type: 'revoke', message_id: id });
            }
        });
    }
    function applyRevoke(data) {
        const el = document.querySelector('.message[data-id="' + data.message_id + '"]');
        if (!el) return;
        const content = el.querySelector('.msg-content');
        if (content) {
            content.classList.add('msg-revoked');
            content.removeAttribute('data-raw');
            content.innerHTML = '<span class="revoked-nick">'
                + esc(data.revoked_by_nickname || '?')
                + '</span> 撤回了一条消息';
        }
        const actions = el.querySelector('.msg-actions');
        if (actions) {
            actions.querySelectorAll('button').forEach(b => {
                const t = (b.getAttribute('title') || '');
                if (t === '删除') return;
                b.remove();
            });
        }
        const re = el.querySelector('.msg-reactions');
        if (re) re.remove();
        R.updateReplyQuotes(data.message_id, true);
        if (data.was_pinned) {
            el.classList.remove('pinned');
            const icon = el.querySelector('.pin-icon');
            if (icon) icon.remove();
            const panel = document.querySelector('.pinned-panel');
            if (panel) {
                const item = panel.querySelector('.pinned-item[data-id="' + data.message_id + '"]');
                if (item) item.remove();
            }
        }
    }
    function updatePinned(id, pinned, msg) {
        const el = document.querySelector('.message[data-id="' + id + '"]');
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
    function initReactionsIn(el) {
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
    }
    function initReactions() {
        document.querySelectorAll('.msg-reactions[data-reactions]').forEach(initReactionsIn);
    }
    R.revokeMessage = revokeMessage;
    R.applyRevoke = applyRevoke;
    R.updatePinned = updatePinned;
    R.updatePinnedPanel = updatePinnedPanel;
    R.renderReaction = renderReaction;
    R.applyReaction = applyReaction;
    R.initReactionsIn = initReactionsIn;
    R.initReactions = initReactions;
    window.revokeMessage = revokeMessage;
})();

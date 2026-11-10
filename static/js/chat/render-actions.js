(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function startInlineEdit(root, bubble, onSave) {
        if (!root || !bubble || root.querySelector('.msg-edit-box')) return;
        const raw = bubble.dataset.raw || bubble.textContent || '';
        bubble.hidden = true;
        const box = document.createElement('div');
        box.className = 'msg-edit-box';
        const ta = document.createElement('textarea');
        ta.className = 'msg-edit-input';
        ta.value = raw;
        ta.rows = Math.min(10, Math.max(2, raw.split('\n').length + 1));
        const bar = document.createElement('div');
        bar.className = 'msg-edit-actions';
        const hint = document.createElement('span');
        hint.className = 'msg-edit-hint';
        hint.textContent = 'Esc 取消 · Ctrl+Enter 保存';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = '取消';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'primary';
        save.textContent = '保存';
        bar.appendChild(hint);
        bar.appendChild(cancel);
        bar.appendChild(save);
        box.appendChild(ta);
        box.appendChild(bar);
        bubble.parentNode.insertBefore(box, bubble.nextSibling);
        ta.focus();
        ta.setSelectionRange(raw.length, raw.length);
        function close() {
            box.remove();
            bubble.hidden = false;
        }
        function submit() {
            const val = ta.value.trim();
            if (!val) {
                if (window.showToast) window.showToast('消息不能为空');
                return;
            }
            if (val === raw.trim()) { close(); return; }
            save.disabled = true;
            onSave(val, close);
        }
        cancel.addEventListener('click', close);
        save.addEventListener('click', submit);
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            } else if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });
    }
    function editMessage(id, btn) {
        const root = btn && btn.closest ? btn.closest('.message') : null;
        if (!root) return;
        const bubble = root.querySelector('.msg-content');
        if (!bubble || bubble.classList.contains('msg-revoked')) return;
        startInlineEdit(root, bubble, function (val, close) {
            if (!window.ChatWS || !window.ChatWS.isOpen()) {
                if (window.showToast) window.showToast('未就绪');
                close();
                return;
            }
            window.ChatWS.send({ type: 'edit', message_id: id, content: val });
            close();
        });
    }
    function applyEdit(id, content, editedAt) {
        const el = document.querySelector('.message[data-id="' + CSS.escape(id) + '"]');
        if (!el) return;
        const bubble = el.querySelector('.msg-content');
        if (!bubble) return;
        bubble.dataset.raw = content;
        bubble.innerHTML = window.renderContent(content);
        bubble.dataset.rendered = '1';
        let mark = el.querySelector('.msg-edited');
        if (!mark) {
            mark = document.createElement('span');
            mark.className = 'msg-edited';
            mark.textContent = '已编辑';
            const time = el.querySelector('.msg-time');
            if (time && time.parentNode) time.parentNode.insertBefore(mark, time.nextSibling);
            else el.querySelector('.msg-header').appendChild(mark);
        }
        mark.title = editedAt || '';
    }
    function copyMessageLink(id, btn) {
        const url = location.href.split('#')[0] + '#msg-' + encodeURIComponent(id);
        if (window.copyToClipboard) window.copyToClipboard(url, btn, '已复制');
        if (window.showToast) window.showToast('消息链接已复制');
    }
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
        el.classList.add('revoked-msg');
        const content = el.querySelector('.msg-content');
        if (content) {
            content.classList.add('msg-revoked');
            content.classList.remove('md-body');
            content.removeAttribute('data-raw');
            content.removeAttribute('data-mode');
            content.removeAttribute('style');
            content.innerHTML = '<a class="revoked-nick" href="/user/'
                + escAttr(data.revoked_by) + '">'
                + esc(data.revoked_by_nickname) + '</a> 撤回了一条消息';
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
        const raw = msg ? (msg.content || '') : '';
        item.innerHTML =
            '<div class="pinned-content md-body" data-raw="' + escAttr(raw) + '"></div>' +
            '<div class="pinned-meta">' + esc(msg ? msg.nickname : '') + '</div>' +
            (canPin
                ? '<div class="pinned-actions"><button type="button" title="取消置顶" data-action="unpin-message" data-id="' + escAttr(id) + '">📌</button></div>'
                : '');
        const content = item.querySelector('.pinned-content');
        content.innerHTML = window.renderContent(raw);
        content.dataset.rendered = '1';
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
    R.startInlineEdit = startInlineEdit;
    R.revokeMessage = revokeMessage;
    R.applyRevoke = applyRevoke;
    R.applyEdit = applyEdit;
    R.updatePinned = updatePinned;
    R.updatePinnedPanel = updatePinnedPanel;
    R.renderReaction = renderReaction;
    R.applyReaction = applyReaction;
    R.initReactionsIn = initReactionsIn;
    R.initReactions = initReactions;
    window.revokeMessage = revokeMessage;
    window.editMessage = editMessage;
    window.copyMessageLink = copyMessageLink;
})();

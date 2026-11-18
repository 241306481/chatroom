(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function startInlineEdit(root, bubble, onSave) {
        if (!root || !bubble || root.querySelector('.msg-edit-box')) return;
        if (root.classList.contains('msg-collapsed') && window.toggleMessageCollapse) {
            window.toggleMessageCollapse(root);
        }
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
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(raw.length, raw.length);
        if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
        function close() {
            box.remove();
            bubble.hidden = false;
            document.dispatchEvent(new CustomEvent('chat-inline-edit-closed'));
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
    function cancelInlineEdit(root) {
        const box = root && root.querySelector('.msg-edit-box');
        if (!box) return false;
        const bubble = root.querySelector('.msg-content, .dm-bubble');
        box.remove();
        if (bubble) bubble.hidden = false;
        return true;
    }
    function preserveEditView(fn) {
        const box = document.querySelector('.msg-edit-box');
        if (!box) { fn(); return; }
        const top = box.getBoundingClientRect().top;
        fn();
        if (!box.isConnected) return;
        const delta = box.getBoundingClientRect().top - top;
        if (!delta) return;
        const list = document.getElementById('messageList');
        const dmList = document.getElementById('dmList');
        const scroller = list && list.contains(box) ? list
            : (dmList && dmList.contains(box) ? dmList : (list || dmList));
        if (scroller) scroller.scrollTop += delta;
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
        preserveEditView(function () {
        const safeId = CSS.escape(id);
        const el = document.querySelector('.message[data-id="' + safeId + '"]');
        if (el) {
            const bubble = el.querySelector('.msg-content');
            if (bubble) {
                bubble.dataset.raw = content;
                bubble.innerHTML = window.renderContent(content);
                bubble.dataset.rendered = '1';
                let mark = el.querySelector('.msg-edited');
                if (!mark) {
                    mark = document.createElement('button');
                    mark.type = 'button';
                    mark.className = 'msg-edited';
                    mark.textContent = '已编辑';
                    const time = el.querySelector('.msg-time');
                    if (time && time.parentNode) time.parentNode.insertBefore(mark, time.nextSibling);
                    else el.querySelector('.msg-header').appendChild(mark);
                }
                mark.dataset.action = 'show-message-history';
                mark.dataset.id = id;
                mark.title = editedAt || '';
                if (window.CollapseUI && window.CollapseUI.refreshMessage) {
                    window.CollapseUI.refreshMessage(el);
                }
            }
        }
        const pin = document.querySelector(
            '.pinned-item[data-id="' + safeId + '"] .pinned-content');
        if (pin) {
            pin.dataset.raw = content;
            pin.innerHTML = window.renderContent(content);
            pin.dataset.rendered = '1';
            if (window.CollapseUI && window.CollapseUI.refreshPinned) {
                window.CollapseUI.refreshPinned(pin.closest('.pinned-item'));
            }
        }
        const preview = Array.from(String(content || '')).slice(0, 80).join('');
        document.querySelectorAll(
            '.message[data-reply-to="' + safeId + '"] .reply-quote-content'
        ).forEach(function (quote) {
            quote.textContent = preview;
        });
        });
    }
    function historyUrl(id, btn) {
        const dm = btn && btn.closest ? btn.closest('.dm-msg') : null;
        if (dm) {
            const peer = document.body.dataset.dmTarget || '';
            if (!peer) return '';
            return '/messages/' + encodeURIComponent(peer) + '/'
                + encodeURIComponent(id) + '/history';
        }
        const m = location.pathname.match(/^\/domain\/([^/]+)\/discuss\/([^/]+)/);
        if (!m) return '';
        return '/domain/' + encodeURIComponent(decodeURIComponent(m[1]))
            + '/discuss/' + encodeURIComponent(decodeURIComponent(m[2]))
            + '/messages/' + encodeURIComponent(id) + '/history';
    }
    function openHistory(versions) {
        const old = document.querySelector('.history-overlay');
        if (old) old.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay history-overlay';
        const box = document.createElement('div');
        box.className = 'modal-box history-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const header = document.createElement('div');
        header.className = 'modal-header';
        const icon = document.createElement('span');
        icon.className = 'modal-icon';
        icon.textContent = '🧾';
        const title = document.createElement('span');
        title.className = 'modal-title';
        title.textContent = '编辑历史';
        header.appendChild(icon);
        header.appendChild(title);
        const body = document.createElement('div');
        body.className = 'modal-body history-body';
        const list = Array.isArray(versions) ? versions.slice().reverse() : [];
        if (!list.length) {
            const empty = document.createElement('p');
            empty.className = 'history-empty';
            empty.textContent = '暂无版本记录';
            body.appendChild(empty);
        }
        list.forEach(function (v, i) {
            const item = document.createElement('div');
            item.className = 'history-item';
            const meta = document.createElement('div');
            meta.className = 'history-meta';
            meta.textContent = (i === 0 ? '当前版本' : '历史版本 ' + (list.length - i))
                + (v.edited_at ? ' · ' + v.edited_at : '');
            const content = document.createElement('div');
            content.className = 'history-content md-body';
            content.innerHTML = window.renderContent(v.content || '');
            item.appendChild(meta);
            item.appendChild(content);
            if (window.CollapseUI && window.CollapseUI.attachHistoryItem) {
                window.CollapseUI.attachHistoryItem(item, meta, content);
            }
            body.appendChild(item);
        });
        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal-btn modal-btn-ok';
        closeBtn.textContent = '关闭';
        footer.appendChild(closeBtn);
        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('show'); });
        function close() {
            document.removeEventListener('keydown', onKey, true);
            overlay.classList.remove('show');
            setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 180);
        }
        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        }
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('mousedown', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', onKey, true);
        closeBtn.focus();
    }
    function showMessageHistory(id, btn) {
        const url = historyUrl(id, btn);
        if (!url) {
            if (window.showToast) window.showToast('无法加载编辑历史');
            return;
        }
        fetch(url, { headers: { 'Accept': 'application/json' } })
            .then(r => r.json().catch(function () {
                return { ok: false, error: '请求失败（' + r.status + '）' };
            })).then(function (res) {
                if (!res.ok) throw new Error(res.error || '加载失败');
                openHistory(res.versions);
            }).catch(function (err) {
                if (window.showToast) window.showToast(err.message || '加载失败');
            });
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
        preserveEditView(function () {
        const el = document.querySelector('.message[data-id="' + data.message_id + '"]');
        if (!el) {
            R.updateReplyQuotes(data.message_id, true);
            if (data.was_pinned) updatePinnedPanel(data.message_id, false, null);
            return;
        }
        cancelInlineEdit(el);
        el.classList.add('revoked-msg');
        el.removeAttribute('data-reply-to');
        const quote = el.querySelector('.msg-reply-quote');
        if (quote) quote.remove();
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
            updatePinnedPanel(data.message_id, false, null);
        }
        });
    }
    function updatePinned(id, pinned, msg) {
        preserveEditView(function () {
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
        });
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
                    empty.textContent = '暂无置顶消息';
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
        const nick = msg ? (msg.nickname || '') : '';
        const createdAt = msg ? (msg.created_at || '') : '';
        item.innerHTML =
            '<div class="pinned-meta-top">' +
              '<span class="pinned-nick">' + esc(nick) + '</span>' +
              '<span class="pinned-time">' + esc(createdAt) + '</span>' +
              '<button type="button" class="pinned-src-btn" data-action="scroll-to-message" ' +
                'data-id="' + escAttr(id) + '" title="定位原消息">↩</button>' +
              '<button type="button" class="pinned-src-btn" data-action="toggle-source" ' +
                'title="查看源码">📄</button>' +
              '</div>' +
            '<div class="pinned-content md-body" data-raw="' + escAttr(raw) + '"></div>' +
            (canPin
                ? '<div class="pinned-actions"><button type="button" title="取消置顶" data-action="unpin-message" data-id="' + escAttr(id) + '">📌</button></div>'
                : '');
        item.classList.remove('pinned-collapsed');
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
        preserveEditView(function () {
        const c = document.getElementById('reactions-' + msgId);
        if (!c) return;
        const existing = c.querySelector('[data-emoji="' + CSS.escape(emoji) + '"]');
        let mine = existing ? existing.classList.contains('mine') : false;
        if (userId === window.MY_UID) mine = !!added;
        renderReaction(c, msgId, emoji, count, mine);
        });
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
    R.cancelInlineEdit = cancelInlineEdit;
    R.preserveEditView = preserveEditView;
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
    window.showMessageHistory = showMessageHistory;
})();

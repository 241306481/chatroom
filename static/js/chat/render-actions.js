(function () {
    const R = window.ChatRender = window.ChatRender || {};
    const pendingEdits = [];
    function takePendingEdits(id) {
        const key = String(id);
        let cleared = false;
        for (let i = pendingEdits.length - 1; i >= 0; i--) {
            const p = pendingEdits[i];
            if (p.id !== key) continue;
            clearTimeout(p.timer);
            pendingEdits.splice(i, 1);
            cleared = true;
        }
        return cleared;
    }
    window.ChatEditQueue = {
        ack: function (token) {
            if (!token) return false;
            const key = String(token);
            const idx = pendingEdits.findIndex(
                p => p.reqId === key || p.id === key);
            if (idx < 0) return false;
            const p = pendingEdits.splice(idx, 1)[0];
            clearTimeout(p.timer);
            p.done(true);
            return true;
        },
        fail: function () {
            const p = pendingEdits.pop();
            if (!p) return false;
            clearTimeout(p.timer);
            p.done(false);
            return true;
        },
    };
    function startInlineEdit(root, bubble, onSave, id) {
        if (!root || !bubble || root.querySelector('.msg-edit-box')) return;
        const wasCollapsed = root.classList.contains('msg-collapsed');
        if (wasCollapsed && window.toggleMessageCollapse) {
            window.toggleMessageCollapse(root);
        }
        const raw = bubble.dataset.raw || bubble.textContent || '';
        bubble.hidden = true;
        const box = document.createElement('div');
        box.className = 'msg-edit-box';
        const editorSource = document.querySelector(
            '.message-input-area [data-context-edit], .dm-input-area [data-context-edit]'
        ) || document.querySelector('[data-context-edit]');
        let ta = null;
        let editor = null;
        if (editorSource && typeof window.initContextEdit === 'function') {
            editor = editorSource.cloneNode(true);
            editor.removeAttribute('data-ctx-init');
            editor.dataset.noDraft = '1';
            editor.dataset.keepTop = '1';
            editor.dataset.editorMode = 'split';
            editor.style.setProperty('--md-editor-height', '220px');
            const suffix = '-msg-edit-' + (id || Date.now()) + '-'
                + Math.random().toString(36).slice(2, 6);
            editor.querySelectorAll('[id]').forEach(function (el) {
                el.id += suffix;
            });
            const submit = editor.querySelector('.md-editor-submit');
            if (submit) submit.remove();
            const heightResize = editor.querySelector('[data-height-resize]');
            if (heightResize) {
                heightResize.dataset.heightResizePos = 'bottom';
                heightResize.classList.remove('md-editor-height-resize-top');
                heightResize.classList.add('md-editor-height-resize-bottom');
                const content = editor.querySelector('.md-editor-content');
                if (content && content.parentNode) {
                    content.parentNode.insertBefore(heightResize, content.nextSibling);
                }
            }
            ta = editor.querySelector('textarea');
            if (ta) {
                ta.value = raw;
                ta.rows = Math.min(10, Math.max(2, raw.split('\n').length + 1));
                box.appendChild(editor);
            }
        }
        if (!ta) {
            editor = null;
            ta = document.createElement('textarea');
            ta.className = 'msg-edit-input';
            ta.value = raw;
            ta.rows = Math.min(10, Math.max(2, raw.split('\n').length + 1));
            box.appendChild(ta);
        }
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
        bar.appendChild(cancel);
        bar.appendChild(save);
        if (editor) {
            const footerLeft = editor.querySelector('.md-editor-footer-left');
            const footerRight = editor.querySelector('.md-editor-footer-right');
            if (footerLeft) footerLeft.appendChild(hint);
            else bar.insertBefore(hint, cancel);
            if (footerRight) footerRight.appendChild(bar);
            else box.appendChild(bar);
        } else {
            bar.insertBefore(hint, cancel);
            box.appendChild(bar);
        }
        bubble.parentNode.insertBefore(box, bubble.nextSibling);
        if (editor) window.initContextEdit(editor);
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(raw.length, raw.length);
        if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
        function close() {
            if (id) takePendingEdits(id);
            box.remove();
            bubble.hidden = false;
            if (wasCollapsed && root.isConnected
                && !root.classList.contains('revoked-msg')
                && window.toggleMessageCollapse) {
                window.toggleMessageCollapse(root);
            }
            document.dispatchEvent(new CustomEvent('chat-inline-edit-closed'));
        }
        function submit() {
            if (save.disabled) return;
            const val = ta.value.trim();
            if (!val) {
                if (window.showToast) window.showToast('消息不能为空');
                return;
            }
            if (val === raw.trim()) { close(); return; }
            save.disabled = true;
            let settled = false;
            let entry = null;
            function settle(ok) {
                if (settled) return;
                settled = true;
                if (entry) {
                    const idx = pendingEdits.indexOf(entry);
                    if (idx >= 0) pendingEdits.splice(idx, 1);
                    if (entry.timer) clearTimeout(entry.timer);
                    entry = null;
                }
                if (ok) { close(); return; }
                save.disabled = false;
                ta.focus();
            }
            if (!id) {
                onSave(val, settle, '');
                return;
            }
            const key = String(id);
            const reqId = 'edit-' + Date.now().toString(36) + '-'
                + Math.random().toString(36).slice(2, 8);
            entry = { id: key, reqId: reqId, done: settle, timer: null };
            pendingEdits.push(entry);
            entry.timer = setTimeout(function () {
                const idx = pendingEdits.indexOf(entry);
                if (idx >= 0) pendingEdits.splice(idx, 1);
                entry = null;
                settle(false);
                if (window.showToast) window.showToast('保存超时，请重试');
            }, 5000);
            onSave(val, settle, reqId);
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
        startInlineEdit(root, bubble, function (val, settle, reqId) {
            if (!window.ChatWS || !window.ChatWS.isOpen()) {
                if (window.showToast) window.showToast('未就绪');
                settle(false);
                return;
            }
            window.ChatWS.send({
                type: 'edit', message_id: id, content: val, edit_id: reqId,
            });
        }, id);
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
                bubble.removeAttribute('data-mode');
                const copyBtn = bubble.querySelector('.source-copy-btn');
                if (copyBtn) copyBtn.remove();
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
        const dn = m ? decodeURIComponent(m[1]) : (window.__DOMAIN__ || '');
        const disc = m ? decodeURIComponent(m[2]) : (window.__DISCUSS__ || '');
        if (!dn || !disc) return '';
        const path = '/discuss/' + encodeURIComponent(disc)
            + '/messages/' + encodeURIComponent(id) + '/history';
        if (window.domainUrl) return window.domainUrl(path);
        return '/domain/' + encodeURIComponent(dn) + path;
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
            content.innerHTML = '<a class="revoked-nick" href="'
                + escAttr(window.userProfileUrl(data.revoked_by)) + '">'
                + esc(data.revoked_by_nickname) + '</a> 撤回了一条消息';
        }
        el.querySelectorAll('.msg-actions').forEach(function (actions) {
            actions.querySelectorAll('button').forEach(b => {
                const t = (b.getAttribute('title') || '');
                if (t === '删除') return;
                b.remove();
            });
        });
        const collapseBtn = el.querySelector('.msg-collapse-avatar-btn');
        if (collapseBtn) collapseBtn.remove();
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

// ============================================================
// 消息 DOM 渲染 + 表情渲染 + 讨论侧栏
// ============================================================
(function () {

    // ============================================================
    // 新消息提示条
    // ============================================================
    let _newMsgCount = 0;
    let _banner = null;

    function isAtBottom() {
        const l = document.getElementById('messageList');
        if (!l) return true;
        // column-reverse：scrollTop = 0 是底部，向上滚为负值
        return Math.abs(l.scrollTop) <= 60;
    }

    function ensureBanner() {
        if (_banner && document.body.contains(_banner)) return _banner;
        const host = document.querySelector('.message-input-area')
                  || document.querySelector('.message-area');
        if (!host) return null;
        _banner = document.createElement('button');
        _banner.type = 'button';
        _banner.className = 'new-msg-banner';
        _banner.hidden = true;
        _banner.addEventListener('click', () => {
            const l = document.getElementById('messageList');
            if (l) l.scrollTop = 0;
            hideNewMsgBanner();
        });
        host.appendChild(_banner);
        return _banner;
    }

    function showNewMsgBanner(inc) {
        const b = ensureBanner();
        if (!b) return;
        _newMsgCount += (inc || 1);
        b.innerHTML = '<span class="arrow">↓</span> ' + _newMsgCount + ' 条新消息';
        b.hidden = false;
    }

    function hideNewMsgBanner() {
        _newMsgCount = 0;
        if (_banner) _banner.hidden = true;
    }

    // 用户滚回底部时自动隐藏
    function bindBottomWatcher() {
        const l = document.getElementById('messageList');
        if (!l || l._bannerBound) return;
        l._bannerBound = true;
        l.addEventListener('scroll', () => {
            if (isAtBottom()) hideNewMsgBanner();
        }, { passive: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindBottomWatcher);
    } else {
        bindBottomWatcher();
    }

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
    function buildMessageEl(msg) {
        const safeColor = function (c) {
            const s = String(c || '');
            if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
            if (/^hsl\(\s*-?\d+(\.\d+)?\s*,\s*\d+(\.\d+)?%\s*,\s*\d+(\.\d+)?%\s*\)$/.test(s)) return s;
            if (/^rgba?\([0-9,\s.]+\)$/.test(s)) return s;
            if (/^[a-zA-Z]{3,20}$/.test(s)) return s;
            return '#888';
        };

        const escSingle = function (s) {
            return String(s == null ? '' : s)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/"/g, '&quot;')
                .replace(/</g, '\\x3c')
                .replace(/>/g, '\\x3e')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r');
        };

        const div = document.createElement('div');
        div.className = 'message';
        if (msg.is_system) div.classList.add('system-msg');
        div.dataset.id = msg.id;
        if (msg.id) div.id = 'msg-' + msg.id;
        if (msg.reply_to) div.dataset.replyTo = msg.reply_to;

        const canPin = window.__CAN_PIN__ === true;
        const canDeleteAny = window.__CAN_DELETE_ANY__ === true;
        const canAddReaction = window.__CAN_ADD_REACTION__ === true;
        const isOwn = msg.user_id === window.MY_UID;
        const showPin = canPin && !msg.revoked;
        const showDelete = canDeleteAny || isOwn;
        const revoked = !!msg.revoked;

        const nick = (msg.nickname || '?')[0];
        const color = safeColor(msg.avatar_color);
        const mid = escSingle(msg.id);

        const canReply = !!document.getElementById('msgInput') && !revoked;
        const replyBtn = canReply
            ? `<button type="button" class="msg-reply-btn" onclick="setReplyTo('${mid}', this)" title="回复">↩️</button>`
            : '';
        const replyQuote = msg.reply_info
            ? (msg.reply_info.deleted
                ? `<div class="msg-reply-quote msg-reply-quote-deleted"><span class="reply-quote-content"><em>该消息已被删除</em></span></div>`
                : msg.reply_info.revoked
                    ? `<div class="msg-reply-quote msg-reply-quote-revoked"><span class="reply-quote-content"><em>该消息已被撤回</em></span></div>`
                    : `<div class="msg-reply-quote" onclick="scrollToMessage('${escSingle(msg.reply_info.id)}')">
                           <span class="reply-quote-nick">${esc(msg.reply_info.nickname)}</span>
                           <span class="reply-quote-content">${esc(msg.reply_info.content)}</span>
                       </div>`)
            : '';
        const revokeBtn = !revoked && (isOwn || window.__CAN_REVOKE_ANY__ === true)
            ? `<button type="button" onclick="revokeMessage('${mid}')" title="撤回">↩️</button>`
            : '';
        const sourceBtn = !revoked
            ? `<button type="button" onclick="toggleSource(this)" title="查看源码">📄</button>`
            : '';
        const reactionBtn = canAddReaction && !revoked
            ? `<button type="button" onclick="toggleReactionPicker('${mid}', this)" title="添加表情">😀</button>`
            : '';
        const reactionsDiv = !revoked
            ? `<div class="msg-reactions" id="reactions-${mid}" data-reactions="${escAttr(msg.reactions_json || '{}')}"></div>`
            : '';
        const contentHtml = revoked
            ? `<div class="msg-content msg-revoked"><span class="revoked-nick">${esc(msg.revoked_by_nickname || msg.nickname)}</span> 撤回了一条消息</div>`
            : `<div class="msg-content" data-raw="${escAttr(msg.content)}">${window.renderContent(msg.content)}</div>`;

        div.innerHTML = `
            <div class="msg-avatar" style="background:${color}">${esc(nick)}</div>
            <div class="msg-body">
                <div class="msg-header">
                    <span class="msg-nick">${esc(msg.nickname)}</span>
                    ${msg.is_mod ? '<span class="badge mod">MOD</span>' : ''}
                    <span class="msg-time">${esc(msg.created_at)}</span>
                    ${replyBtn}
                    <div class="msg-actions">
                        ${sourceBtn}
                        ${reactionBtn}
                        ${showPin ? `<button type="button" onclick="pinMessage('${mid}')" title="置顶">📌</button>` : ''}
                        ${revokeBtn}
                        ${showDelete ? `<button type="button" onclick="deleteMessage('${mid}')" title="删除">🗑</button>` : ''}
                    </div>
                </div>
                ${replyQuote}
                ${contentHtml}
                ${reactionsDiv}
            </div>`;
        return div;
    }

    function appendMessage(msg) {
        const list = document.getElementById('messageList');
        if (!list) return;
        const inner = list.querySelector('.message-list-inner') || list;
        const empty = inner.querySelector('.empty');
        if (empty) empty.remove();
        inner.insertBefore(buildMessageEl(msg), inner.firstElementChild);
    }

    function prependMessage(msg) {
        const list = document.getElementById('messageList');
        if (!list) return;
        const inner = list.querySelector('.message-list-inner') || list;
        if (inner.querySelector('.message[data-id="' + (msg.id || '') + '"]')) return;
        const div = buildMessageEl(msg);
        inner.appendChild(div);
        const re = div.querySelector('.msg-reactions[data-reactions]');
        if (re) initReactionsIn(re);
    }

    function revokeMessage(id) {
        window.showConfirm('撤回这条消息？').then(function (ok) {
            if (!ok) return;
            if (window.ChatWS && window.ChatWS.isOpen()) {
                window.ChatWS.send({ type: 'revoke', message_id: id });
            }
        });
    }

    function updateReplyQuotes(messageId, revoked) {
        document.querySelectorAll('[data-reply-to="' + messageId + '"]').forEach(msgEl => {
            const q = msgEl.querySelector('.msg-reply-quote');
            if (!q) return;
            q.classList.add(revoked ? 'msg-reply-quote-revoked' : 'msg-reply-quote-deleted');
            q.innerHTML = '<span class="reply-quote-content"><em>'
                + (revoked ? '该消息已被撤回' : '该消息已被删除')
                + '</em></span>';
            q.onclick = null;
        });
    }

    function applyRevoke(data) {
        const el = document.querySelector(`.message[data-id="${data.message_id}"]`);
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

        updateReplyQuotes(data.message_id, true);

        if (data.was_pinned) {
            el.classList.remove('pinned');
            const icon = el.querySelector('.pin-icon');
            if (icon) icon.remove();
        }

        if (data.was_pinned) {
            const panel = document.querySelector('.pinned-panel');
            if (panel) {
                const item = panel.querySelector('.pinned-item[data-id="' + data.message_id + '"]');
                if (item) item.remove();
            }
        }
    }

    function removeMessage(id) {
        const el = document.querySelector(`.message[data-id="${id}"]`);
        if (el) el.remove();
    }

    function applyDelete(messageId) {
        const el = document.querySelector('.message[data-id="' + messageId + '"]');
        if (el) el.remove();
        updateReplyQuotes(messageId, false);
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

    // ---------- 工具 ----------
    function scrollBottom() {
        const l = document.getElementById('messageList');
        if (l) l.scrollTop = 0;
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
        prependMessage,
        buildMessageEl,
        removeMessage,
        applyDelete,
        updatePinned,
        updatePinnedPanel,
        renderReaction,
        applyReaction,
        renderAllHistory,
        initReactions,
        scrollBottom,
        showToast,
        isAtBottom,
        showNewMsgBanner,
        hideNewMsgBanner,
        revokeMessage,
        applyRevoke,
    };

    window.revokeMessage = revokeMessage;
})();
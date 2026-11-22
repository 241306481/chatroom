(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function appendMessage(msg) {
        const list = document.getElementById('messageList');
        if (!list) return;
        const inner = list.querySelector('.message-list-inner') || list;
        const editBox = inner.querySelector('.msg-edit-box');
        const editTop = editBox ? editBox.getBoundingClientRect().top : 0;
        const atBottom = !R.isAtBottom || R.isAtBottom();
        const scrollTop = list.scrollTop;
        const scrollHeight = list.scrollHeight;
        const anchor = !atBottom && R.captureScrollAnchor
            ? R.captureScrollAnchor(list) : null;
        const empty = inner.querySelector('.empty');
        if (empty) empty.remove();
        inner.insertBefore(R.buildMessageEl(msg), inner.firstElementChild);
        if (anchor && R.restoreScrollAnchor) {
            R.restoreScrollAnchor(list, anchor);
        } else if (editBox) {
            const delta = editBox.getBoundingClientRect().top - editTop;
            if (delta) list.scrollTop += delta;
        } else if (!atBottom) {
            const grew = list.scrollHeight - scrollHeight;
            if (grew) list.scrollTop = scrollTop - grew;
        }
        if (window.MessageBatch && window.MessageBatch.refresh) {
            window.MessageBatch.refresh();
        }
    }
    function prependMessage(msg) {
        const list = document.getElementById('messageList');
        if (!list) return;
        const inner = list.querySelector('.message-list-inner') || list;
        if (inner.querySelector('.message[data-id="' + (msg.id || '') + '"]')) return;
        const editBox = inner.querySelector('.msg-edit-box');
        const editTop = editBox ? editBox.getBoundingClientRect().top : 0;
        const atBottom = !R.isAtBottom || R.isAtBottom();
        const anchor = !atBottom && R.captureScrollAnchor
            ? R.captureScrollAnchor(list) : null;
        const div = R.buildMessageEl(msg);
        inner.appendChild(div);
        if (anchor && R.restoreScrollAnchor) {
            R.restoreScrollAnchor(list, anchor);
        } else if (editBox) {
            const delta = editBox.getBoundingClientRect().top - editTop;
            if (delta) list.scrollTop += delta;
        }
        const re = div.querySelector('.msg-reactions[data-reactions]');
        if (re) R.initReactionsIn(re);
        if (window.MessageBatch && window.MessageBatch.refresh) {
            window.MessageBatch.refresh();
        }
    }
    function removeMessage(id) {
        const el = document.querySelector('.message[data-id="' + id + '"]');
        if (el) el.remove();
    }
    function applyDelete(messageId) {
        const preserve = R.preserveEditView || function (fn) { fn(); };
        preserve(function () {
            const el = document.querySelector('.message[data-id="' + messageId + '"]');
            if (el) el.remove();
            const pin = document.querySelector(
                '.pinned-item[data-id="' + messageId + '"]');
            if (pin) {
                if (R.updatePinnedPanel) R.updatePinnedPanel(messageId, false, null);
                else pin.remove();
            }
            updateReplyQuotes(messageId, false);
            if (window.MessageBatch && window.MessageBatch.refresh) {
                window.MessageBatch.refresh();
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
    function renderAllHistory() {
        document.querySelectorAll('.msg-content[data-raw]').forEach(function (el) {
            if (el.dataset.rendered === '1') return;
            if (el.dataset.forwardRef) {
                if (window.ChatForwardCard) window.ChatForwardCard.enhance(el);
                el.dataset.rendered = '1';
                return;
            }
            el.innerHTML = window.renderContent(el.dataset.raw || '');
            el.dataset.rendered = '1';
        });
    }
    R.appendMessage = appendMessage;
    R.prependMessage = prependMessage;
    R.removeMessage = removeMessage;
    R.applyDelete = applyDelete;
    R.updateReplyQuotes = updateReplyQuotes;
    R.renderAllHistory = renderAllHistory;
})();

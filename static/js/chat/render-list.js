(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function appendMessage(msg) {
        const list = document.getElementById('messageList');
        if (!list) return;
        const inner = list.querySelector('.message-list-inner') || list;
        const empty = inner.querySelector('.empty');
        if (empty) empty.remove();
        inner.insertBefore(R.buildMessageEl(msg), inner.firstElementChild);
    }
    function prependMessage(msg) {
        const list = document.getElementById('messageList');
        if (!list) return;
        const inner = list.querySelector('.message-list-inner') || list;
        if (inner.querySelector('.message[data-id="' + (msg.id || '') + '"]')) return;
        const div = R.buildMessageEl(msg);
        inner.appendChild(div);
        const re = div.querySelector('.msg-reactions[data-reactions]');
        if (re) R.initReactionsIn(re);
    }
    function removeMessage(id) {
        const el = document.querySelector('.message[data-id="' + id + '"]');
        if (el) el.remove();
    }
    function applyDelete(messageId) {
        const el = document.querySelector('.message[data-id="' + messageId + '"]');
        if (el) el.remove();
        const pin = document.querySelector(
            '.pinned-item[data-id="' + messageId + '"]');
        if (pin) pin.remove();
        updateReplyQuotes(messageId, false);
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

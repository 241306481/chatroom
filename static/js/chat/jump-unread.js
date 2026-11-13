(function () {
    const list = document.getElementById('messageList');
    const btn = document.getElementById('jumpUnreadBtn');
    if (!list || !btn) return;
    const key = 'chatroom-last-read:' + location.pathname + location.search;
    function readLast() {
        try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    }
    function writeLast(id) {
        if (!id) return;
        try { localStorage.setItem(key, id); } catch (e) {}
    }
    function messageEls() {
        return Array.from(list.querySelectorAll('.message[data-id]'));
    }
    function newestId() {
        const els = messageEls();
        return els.length ? els[0].dataset.id : '';
    }
    function findUnread() {
        const last = readLast();
        if (!last) return null;
        const els = messageEls();
        if (!els.length) return null;
        const idx = els.findIndex(el => el.dataset.id === last);
        if (idx === 0) return null;
        if (idx > 0) return els[idx - 1];
        return els[els.length - 1];
    }
    function unreadCount(firstUnread) {
        const idx = messageEls().indexOf(firstUnread);
        return idx >= 0 ? idx + 1 : 0;
    }
    function refresh() {
        const unread = findUnread();
        btn.hidden = !unread;
        if (unread) {
            const count = unreadCount(unread);
            btn.textContent = count > 1 ? '跳到未读 (' + count + ')' : '跳到未读';
        }
        return unread;
    }
    function atBottom() {
        return window.ChatRender && window.ChatRender.isAtBottom
            ? window.ChatRender.isAtBottom() : true;
    }
    function markRead() {
        if (document.visibilityState !== 'visible') return;
        if (!atBottom()) return;
        writeLast(newestId());
        refresh();
    }
    window.markDiscussionRead = markRead;
    btn.addEventListener('click', function () {
        const unread = findUnread();
        if (!unread) return;
        unread.scrollIntoView({ behavior: 'smooth', block: 'center' });
        unread.classList.add('highlight');
        setTimeout(() => unread.classList.remove('highlight'), 2000);
        writeLast(newestId());
        refresh();
    });
    list.addEventListener('scroll', function () {
        if (atBottom()) markRead();
    }, { passive: true });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            refresh();
        } else if (atBottom()) {
            writeLast(newestId());
        }
    });
    window.addEventListener('beforeunload', markRead);
    if (!readLast()) writeLast(newestId());
    refresh();
    const inner = list.querySelector('.message-list-inner') || list;
    if (window.MutationObserver) {
        new MutationObserver(refresh).observe(inner, { childList: true });
    }
})();

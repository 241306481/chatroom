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
    function isOwn(el) {
        const me = String(window.MY_UID || '');
        return !!me && String(el.dataset.userId || '') === me;
    }
    function findUnread() {
        const last = readLast();
        if (!last) return null;
        const els = messageEls();
        if (!els.length) return null;
        const idx = els.findIndex(el => el.dataset.id === last);
        if (idx === 0) return null;
        if (idx > 0) {
            for (let i = idx - 1; i >= 0; i--) {
                if (!isOwn(els[i])) return els[i];
            }
            return null;
        }
        for (let i = els.length - 1; i >= 0; i--) {
            if (!isOwn(els[i])) return els[i];
        }
        return null;
    }
    function unreadCount(firstUnread) {
        const els = messageEls();
        const idx = els.indexOf(firstUnread);
        return idx >= 0
            ? els.slice(0, idx + 1).filter(function (el) {
                return !isOwn(el);
            }).length
            : 0;
    }
    const initialUnread = findUnread();
    let trackedUnread = initialUnread;
    let trackedCount = initialUnread ? unreadCount(initialUnread) : 0;
    let hideUntil = 0;
    let hideTimer = 0;
    let ready = false;
    function refresh() {
        const show = !!trackedUnread && document.body.contains(trackedUnread)
            && Date.now() >= hideUntil;
        btn.hidden = !show;
        if (show) {
            btn.textContent = trackedCount > 1
                ? '跳到未读 (' + trackedCount + ')' : '跳到未读';
        }
        return show ? trackedUnread : null;
    }
    function clearTracked() {
        trackedUnread = null;
        trackedCount = 0;
        refresh();
    }
    function atBottom() {
        return window.ChatRender && window.ChatRender.isAtBottom
            ? window.ChatRender.isAtBottom() : true;
    }
    function jumpToUnread() {
        const unread = findUnread() || trackedUnread;
        if (!unread) return false;
        unread.scrollIntoView({ behavior: 'smooth', block: 'center' });
        unread.classList.add('highlight');
        setTimeout(() => unread.classList.remove('highlight'), 2000);
        writeLast(newestId());
        clearTracked();
        return true;
    }
    function markRead(force) {
        if (document.visibilityState !== 'visible') return;
        if (!force && !atBottom()) return;
        if (force) {
            hideUntil = Date.now() + 1500;
            clearTimeout(hideTimer);
            hideTimer = setTimeout(refresh, 1600);
        }
        writeLast(newestId());
        clearTracked();
    }
    window.markDiscussionRead = markRead;
    window.ChatRender = window.ChatRender || {};
    window.ChatRender.jumpToUnread = jumpToUnread;
    btn.addEventListener('click', function () {
        jumpToUnread();
    });
    list.addEventListener('scroll', function () {
        if (ready && atBottom()) markRead();
        else refresh();
    }, { passive: true });
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            markRead();
            refresh();
        } else if (atBottom()) {
            writeLast(newestId());
        }
    });
    window.addEventListener('beforeunload', function () { markRead(); });
    if (!readLast()) writeLast(newestId());
    refresh();
    setTimeout(function () { ready = true; }, 600);
    const inner = list.querySelector('.message-list-inner') || list;
    if (window.MutationObserver) {
        new MutationObserver(refresh).observe(inner, { childList: true });
    }
})();

(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function isAtBottom() {
        const l = document.getElementById('messageList');
        if (!l) return true;
        return Math.abs(l.scrollTop) <= 60;
    }
    let _newMsgCount = 0;
    let _banner = null;
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
    R.isAtBottom = isAtBottom;
    R.showNewMsgBanner = showNewMsgBanner;
    R.hideNewMsgBanner = hideNewMsgBanner;
    R.addDiscussionToSidebar = addDiscussionToSidebar;
    R.removeDiscussionFromSidebar = removeDiscussionFromSidebar;
    R.scrollBottom = scrollBottom;
    R.showToast = showToast;
})();

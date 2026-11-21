(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function isAtBottom() {
        const l = document.getElementById('messageList');
        if (!l) return true;
        return Math.abs(l.scrollTop) <= 60;
    }
    let _newMsgCount = 0;
    let _banner = null;
    let _bannerShownAt = 0;
    let _bannerGuardTimer = 0;
    let _bannerFirstId = '';
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
            const jumped = window.ChatRender && window.ChatRender.jumpToUnread
                && window.ChatRender.jumpToUnread();
            if (!jumped && _bannerFirstId) {
                const el = document.querySelector('.message[data-id="' + _bannerFirstId + '"]');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            hideNewMsgBanner();
        });
        host.appendChild(_banner);
        return _banner;
    }
    function showNewMsgBanner(inc, messageId) {
        const b = ensureBanner();
        if (!b) return;
        if (!_bannerFirstId && messageId) _bannerFirstId = String(messageId);
        _newMsgCount += (inc || 1);
        _bannerShownAt = Date.now();
        b.innerHTML = '<span class="arrow">↓</span> ' + _newMsgCount + ' 条新消息';
        b.hidden = false;
        clearTimeout(_bannerGuardTimer);
        _bannerGuardTimer = setTimeout(function () {
            if (isAtBottom()) hideNewMsgBanner();
        }, 500);
    }
    function hideNewMsgBanner() {
        _newMsgCount = 0;
        _bannerFirstId = '';
        clearTimeout(_bannerGuardTimer);
        if (_banner) _banner.hidden = true;
    }
    function bindBottomWatcher() {
        const l = document.getElementById('messageList');
        if (!l || l._bannerBound) return;
        l._bannerBound = true;
        l.addEventListener('scroll', () => {
            if (isAtBottom() && Date.now() - _bannerShownAt > 500) {
                hideNewMsgBanner();
            }
        }, { passive: true });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindBottomWatcher);
    } else {
        bindBottomWatcher();
    }
    function sidebarId(a) {
        const el = a.querySelector('.disc-item-id');
        return el ? String(el.textContent || '').replace(/^#/, '') : '';
    }
    function sortDiscussionSidebar() {
        const sidebar = document.querySelector('.sidebar-discussions');
        if (!sidebar) return;
        const links = Array.from(sidebar.querySelectorAll('a.disc-item'));
        if (links.length < 2) return;
        const desired = links.slice().sort((a, b) => {
            const ap = !!a.querySelector('.pinned-badge');
            const bp = !!b.querySelector('.pinned-badge');
            if (ap !== bp) return ap ? -1 : 1;
            const ai = sidebarId(a);
            const bi = sidebarId(b);
            if (ai === 'general') return -1;
            if (bi === 'general') return 1;
            return ai.localeCompare(bi);
        });
        if (desired.every((a, index) => a === links[index])) return;
        desired.forEach(a => sidebar.appendChild(a));
    }
    function addDiscussionToSidebar(id, title, pinned) {
        const sidebar = document.querySelector('.sidebar-discussions');
        if (!sidebar) return;
        if (sidebar.querySelector('a[href$="/discuss/' + id + '"]')) return;
        const empty = sidebar.querySelector('.empty');
        if (empty) empty.remove();
        const DOMAIN = window.__DOMAIN__ || '';
        const a = document.createElement('a');
        a.href = '/domain/' + encodeURIComponent(DOMAIN) + '/discuss/' + id;
        a.className = 'disc-item';
        a.innerHTML = (pinned ? '<span class="pinned-badge">置顶</span>' : '')
            + '<span class="disc-item-id">#' + esc(id) + '</span>'
            + (title ? '<span class="disc-item-title">' + esc(title) + '</span>' : '');
        sidebar.appendChild(a);
        sortDiscussionSidebar();
    }
    function removeDiscussionFromSidebar(id) {
        const sidebar = document.querySelector('.sidebar-discussions');
        if (!sidebar) return;
        const a = sidebar.querySelector('a[href$="/discuss/' + id + '"]');
        if (a) a.remove();
    }
    function updateDiscussionInSidebar(id, title, oldId, pinned) {
        if (oldId && String(oldId) !== String(id)) {
            removeDiscussionFromSidebar(oldId);
        }
        const sidebar = document.querySelector('.sidebar-discussions');
        if (!sidebar) return;
        const a = sidebar.querySelector('a[href$="/discuss/' + id + '"]');
        if (!a) {
            addDiscussionToSidebar(id, title, pinned);
            return;
        }
        let badge = a.querySelector('.pinned-badge');
        if (pinned === true && !badge) {
            badge = document.createElement('span');
            badge.className = 'pinned-badge';
            badge.textContent = '置顶';
            a.insertBefore(badge, a.firstChild);
        } else if (pinned === false && badge) {
            badge.remove();
        }
        const idEl = a.querySelector('.disc-item-id');
        if (idEl) idEl.textContent = '#' + id;
        let titleEl = a.querySelector('.disc-item-title');
        if (title) {
            if (!titleEl) {
                titleEl = document.createElement('span');
                titleEl.className = 'disc-item-title';
                a.appendChild(titleEl);
            }
            titleEl.textContent = title;
        } else if (titleEl) {
            titleEl.remove();
        }
        sortDiscussionSidebar();
    }
    function scrollBottom() {
        const l = document.getElementById('messageList');
        if (l) l.scrollTop = 0;
    }
    function captureScrollAnchor(scroller) {
        if (!scroller) return null;
        const box = scroller.getBoundingClientRect();
        const items = scroller.querySelectorAll('[data-id]');
        for (const el of items) {
            const rect = el.getBoundingClientRect();
            if (rect.bottom > box.top && rect.top < box.bottom) {
                return { el: el, top: rect.top };
            }
        }
        return null;
    }
    function restoreScrollAnchor(scroller, anchor) {
        if (!scroller || !anchor || !anchor.el || !anchor.el.isConnected) return;
        const delta = anchor.el.getBoundingClientRect().top - anchor.top;
        if (delta) scroller.scrollTop += delta;
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
    R.updateDiscussionInSidebar = updateDiscussionInSidebar;
    R.scrollBottom = scrollBottom;
    R.captureScrollAnchor = captureScrollAnchor;
    R.restoreScrollAnchor = restoreScrollAnchor;
    R.showToast = showToast;
})();

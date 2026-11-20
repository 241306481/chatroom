(function () {
    function section() {
        return document.querySelector('.site-announcement');
    }
    function updateToggle(sec) {
        const btn = sec.querySelector('.site-announcement-toggle');
        if (!btn) return;
        const expanded = sec.classList.contains('expanded');
        btn.textContent = expanded ? '收起' : '展开';
        btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    function apply(text) {
        const sec = section();
        if (!sec) return;
        const content = sec.querySelector('.site-announcement-content');
        if (!content) return;
        const raw = text == null ? '' : String(text);
        content.dataset.raw = raw;
        sec.classList.remove('expanded');
        if (!raw) {
            sec.hidden = true;
            content.innerHTML = '';
            delete content.dataset.rendered;
            updateToggle(sec);
            return;
        }
        if (window.renderContent) {
            content.innerHTML = window.renderContent(raw);
        } else {
            content.textContent = raw;
        }
        content.dataset.rendered = '1';
        sec.hidden = false;
        updateToggle(sec);
    }
    function init() {
        const sec = section();
        if (!sec) return;
        const content = sec.querySelector('.site-announcement-content');
        if (!content) return;
        apply(content.dataset.raw || '');
    }
    window.SiteAnnouncement = { apply: apply };
    document.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest
            ? e.target.closest('.site-announcement-toggle') : null;
        if (!btn) return;
        const sec = btn.closest('.site-announcement');
        if (!sec) return;
        sec.classList.toggle('expanded');
        updateToggle(sec);
    });
    window.addEventListener('chatroom:site-announcement', function (e) {
        apply(e.detail ? e.detail.text : '');
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    function connectPublicSocket() {
        if (!section()) return;
        const proto = window.__WS_PROTOCOL__
            || (location.protocol === 'https:' ? 'wss' : 'ws');
        let socket;
        let retryTimer = 0;
        let attempts = 0;
        function schedule() {
            if (retryTimer) return;
            const delay = Math.min(30000, 3000 * Math.pow(1.5, attempts++));
            retryTimer = setTimeout(function () {
                retryTimer = 0;
                connect();
            }, delay);
        }
        function connect() {
            try {
                socket = new WebSocket(proto + '://' + location.host + '/ws/site');
            } catch (e) {
                schedule();
                return;
            }
            socket.onopen = function () {
                attempts = 0;
            };
            socket.onmessage = function (ev) {
                let data;
                try { data = JSON.parse(ev.data); } catch (e) { return; }
                if (data && data.type === 'site_announcement') apply(data.text);
            };
            socket.onclose = function () {
                socket = null;
                schedule();
            };
            socket.onerror = function () {
                try { socket.close(); } catch (e) {}
            };
        }
        connect();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', connectPublicSocket);
    } else {
        connectPublicSocket();
    }
})();

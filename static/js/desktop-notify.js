(function () {
    function supported() {
        return typeof window.Notification === 'function';
    }
    function updateButton() {
        const btn = document.getElementById('desktopNotifyBtn');
        if (!btn) return;
        if (!supported()) {
            btn.hidden = true;
            return;
        }
        const state = window.Notification.permission;
        if (state === 'granted') {
            btn.textContent = '🔔 桌面通知已开启';
            btn.disabled = false;
        } else if (state === 'denied') {
            btn.textContent = '🔕 桌面通知已被浏览器禁用';
            btn.disabled = true;
        } else {
            btn.textContent = '🔔 开启桌面通知';
            btn.disabled = false;
        }
    }
    window.showDesktopNotification = function (opts) {
        if (!supported() || window.Notification.permission !== 'granted') return null;
        if (!document.hidden) return null;
        opts = opts || {};
        const options = {
            body: String(opts.content || ''),
            tag: opts.tag || 'chatroom',
            renotify: false,
        };
        const icon = window.Avatar && opts.avatarUid
            ? window.Avatar.srcOf({
                id: opts.avatarUid,
                avatar_ext: opts.avatarExt || '',
            })
            : '';
        if (icon) options.icon = icon;
        let note;
        try {
            note = new window.Notification(String(opts.title || '新消息'), options);
        } catch (e) {
            return null;
        }
        note.onclick = function () {
            try { window.focus(); } catch (e) {}
            if (typeof opts.onClick === 'function') opts.onClick();
            try { note.close(); } catch (e) {}
        };
        note.onclose = function () {
            if (typeof opts.onClose === 'function') opts.onClose();
        };
        return note;
    };
    document.addEventListener('click', function (e) {
        const btn = e.target.closest && e.target.closest('#desktopNotifyBtn');
        if (!btn || btn.disabled) return;
        if (!supported()) return;
        if (window.Notification.permission === 'granted') {
            if (window.showToast) window.showToast('桌面通知已开启');
            updateButton();
            return;
        }
        window.Notification.requestPermission().then(function () {
            updateButton();
            if (window.Notification.permission === 'granted' && window.showToast) {
                window.showToast('桌面通知已开启');
            }
        });
    });
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', updateButton);
    } else {
        updateButton();
    }
})();

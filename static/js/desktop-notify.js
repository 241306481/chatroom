(function () {
    function supported() {
        return typeof window.Notification === 'function';
    }
    function secure() {
        return window.isSecureContext !== false;
    }
    function updateButton() {
        const btn = document.getElementById('desktopNotifyBtn');
        if (!btn) return;
        if (!supported()) {
            btn.textContent = '🔕 浏览器不支持桌面通知';
            btn.disabled = true;
            btn.title = '当前浏览器不支持 Notification API';
            return;
        }
        if (!secure()) {
            btn.textContent = '🔕 桌面通知需要 HTTPS';
            btn.disabled = false;
            btn.title = '请通过 HTTPS 或 localhost 访问后再开启';
            return;
        }
        const state = window.Notification.permission;
        btn.disabled = false;
        if (state === 'granted') {
            btn.textContent = '🔔 桌面通知已开启';
            btn.title = '点击发送一条测试通知';
        } else if (state === 'denied') {
            btn.textContent = '🔕 桌面通知已被浏览器禁止';
            btn.title = '请在浏览器站点设置中允许通知';
        } else {
            btn.textContent = '🔔 开启桌面通知';
            btn.title = '点击授权桌面通知';
        }
    }
    window.showDesktopNotification = function (opts) {
        if (!supported() || window.Notification.permission !== 'granted') return null;
        opts = opts || {};
        if (!opts.force && !document.hidden) return null;
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
    function testNotification() {
        const note = window.showDesktopNotification({
            title: '聊天室',
            content: '桌面通知已开启，收到新消息时会在这里提醒你。',
            tag: 'chatroom-test',
            force: true,
        });
        if (window.showToast) {
            window.showToast(note ? '已发送测试通知' : '桌面通知不可用');
        }
    }
    function enableNotifications() {
        if (!supported()) {
            if (window.showAlert) window.showAlert('当前浏览器不支持桌面通知');
            return;
        }
        if (!secure()) {
            if (window.showAlert) {
                window.showAlert('桌面通知需要 HTTPS 或 localhost 环境，请更换访问地址后重试');
            }
            updateButton();
            return;
        }
        if (window.Notification.permission === 'granted') {
            testNotification();
            updateButton();
            return;
        }
        if (window.Notification.permission === 'denied') {
            if (window.showAlert) {
                window.showAlert('通知权限已被浏览器禁止，请在站点设置中允许通知');
            }
            updateButton();
            return;
        }
        window.Notification.requestPermission().then(function (permission) {
            updateButton();
            if (permission === 'granted') testNotification();
            else if (window.showToast) window.showToast('未开启桌面通知');
        }).catch(function () {
            if (window.showToast) window.showToast('无法请求通知权限');
        });
    }
    function bind() {
        const btn = document.getElementById('desktopNotifyBtn');
        if (!btn) return;
        if (btn.dataset.notifyBound !== '1') {
            btn.dataset.notifyBound = '1';
            btn.addEventListener('click', enableNotifications);
        }
        updateButton();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
    document.addEventListener('app:content', bind);
})();

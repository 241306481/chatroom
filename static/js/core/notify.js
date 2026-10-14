// ============================================================
// 左下角通知卡片
// ============================================================
window.showNotification = function (opts) {
    opts = opts || {};
    var container = document.getElementById('notificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notificationContainer';
        document.body.appendChild(container);
    }
    var card = document.createElement('div');
    card.className = 'notification-card';
    var title = opts.title || '新消息';
    var color = opts.color || '#1890ff';
    var avatarText = opts.avatar != null ? String(opts.avatar) : (title || '?')[0];
    card.innerHTML =
        '<div class="notification-avatar">' +
            esc(avatarText) +
        '</div>' +
        '<div class="notification-body">' +
            '<div class="notification-title">' + esc(title) + '</div>' +
            '<div class="notification-content">' + esc(opts.content || '') + '</div>' +
        '</div>' +
        '<button class="notification-close" type="button">×</button>';
    // 背景色用 style 接口设置，不参与 innerHTML 拼接：
    // color 来自私信负载里的 avatar_color，是持久化的用户可控字段，
    // 拼进双引号属性里一个 " 就能闭合属性注入事件处理器。
    // esc() 只处理 & < >，挡不住属性闭合。
    var avatar = card.querySelector('.notification-avatar');
    if (avatar) avatar.style.background = color;

    if (opts.onClick) {
        card.addEventListener('click', function (e) {
            if (e.target.classList.contains('notification-close')) return;
            opts.onClick();
            close();
        });
    }
    var closeBtn = card.querySelector('.notification-close');
    closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        close();
    });
    function close() {
        card.classList.add('closing');
        setTimeout(function () { card.remove(); }, 300);
    }
    container.appendChild(card);
    var timer = setTimeout(close, opts.duration || 5000);
    card.addEventListener('mouseenter', function () { clearTimeout(timer); });
    card.addEventListener('mouseleave', function () {
        timer = setTimeout(close, 2000);
    });
};

// ============================================================
// 通用轻提示（表单提交成功等）
// ============================================================
window.showToast = function (msg) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
};

// ============================================================
// 未读徽章 +1
// ============================================================
window.bumpUnreadBadge = function () {
    const anchors = document.querySelectorAll('.topbar-nav a[href="/messages"]');
    anchors.forEach(a => {
        let badge = a.querySelector('.badge-unread');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'badge-unread';
            badge.textContent = '1';
            a.appendChild(badge);
        } else {
            badge.textContent = String(parseInt(badge.textContent || '0', 10) + 1);
        }
    });
};
// ============================================================
// 未读私信提示（打开任意页面时，若有未读，左下角弹卡片）
// 每次加载都会弹（不做 session 去重）
// ============================================================
(function () {
    const count = parseInt(window.__UNREAD_COUNT__ || '0', 10);
    if (!count || count <= 0) return;

    const path = location.pathname;
    if (path.startsWith('/messages')) return;
    if (path.startsWith('/login') || path.startsWith('/register')) return;

    function fire() {
        if (typeof window.showNotification !== 'function') {
            setTimeout(fire, 200);
            return;
        }
        window.showNotification({
            title: '你有消息未读',
            content: count + ' 条未读私信，点击查看',
            color: '#f5222d',
            avatar: '📧',
            duration: 8000,
            onClick: function () {
                location.href = '/messages';
            },
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fire);
    } else {
        fire();
    }
})();

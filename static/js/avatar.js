'use strict';
// 前端头像渲染：有图用 img，否则首字+颜色，加载失败自动回退
(function () {
    const EXTS = { png: 1, jpg: 1, gif: 1, webp: 1 };

    function srcOf(user) {
        if (!user || !user.id || !user.avatar_ext) return '';
        const ext = String(user.avatar_ext).toLowerCase();
        if (!EXTS[ext]) return '';
        return '/avatar/' + encodeURIComponent(String(user.id)) + '/' + ext;
    }

    // 造一个头像元素，样式类由调用方给
    function build(user, cls) {
        const src = srcOf(user);
        const nick = (user && user.nickname) || '?';

        if (src) {
            const img = document.createElement('img');
            img.className = (cls || '') + ' avatar-img';
            img.alt = '';
            img.loading = 'lazy';
            img.addEventListener('error', function () {
                img.replaceWith(fallback(user, cls));
            });
            img.src = src;
            return img;
        }
        return fallback(user, cls);
    }

    function fallback(user, cls) {
        const s = document.createElement('span');
        s.className = cls || '';
        s.style.background = (user && user.avatar_color) || '#888';
        s.textContent = (user && user.nickname ? user.nickname[0] : '?');
        return s;
    }

    // 直接写进已有的容器（就地替换）
    function apply(container, user, cls) {
        if (!container) return;
        container.replaceWith(build(user, cls));
    }

    window.Avatar = { build, fallback, srcOf, apply };
})();
'use strict';
(function () {
    const EXTS = { png: 1, jpg: 1, gif: 1, webp: 1 };
    const COLOR_FALLBACK = '#888';
    function avatarText(nickname) {
        const chars = Array.from(String(nickname == null ? '?' : nickname));
        if (!chars.length) return '?';
        const first = chars[0];
        const cp = first.codePointAt(0);
        if (cp > 0xFFFF) return first;
        if (/[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\uac00-\ud7af]/.test(first)) {
            return first;
        }
        return chars.slice(0, 2).join('');
    }
    function safeColor(c) {
        const s = String(c == null ? '' : c).trim();
        if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
        if (/^hsl\(\s*-?\d+(\.\d+)?\s*,\s*\d+(\.\d+)?%\s*,\s*\d+(\.\d+)?%\s*\)$/.test(s)) return s;
        if (/^rgba?\([0-9,\s.]+\)$/.test(s)) return s;
        if (/^[a-zA-Z]{3,20}$/.test(s)) return s;
        return COLOR_FALLBACK;
    }
    function srcOf(user) {
        if (!user || !user.id || !user.avatar_ext) return '';
        const ext = String(user.avatar_ext).toLowerCase();
        if (!EXTS[ext]) return '';
        return '/avatar/' + encodeURIComponent(String(user.id)) + '/' + ext;
    }
    function build(user, cls) {
        const src = srcOf(user);
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
        s.style.background = safeColor(user && user.avatar_color);
        s.textContent = avatarText(user && user.nickname);
        return s;
    }
    function apply(container, user, cls) {
        if (!container) return;
        container.replaceWith(build(user, cls));
    }
    window.Avatar = { build, fallback, srcOf, apply, avatarText, safeColor };
})();

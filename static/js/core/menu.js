// ============================================================
// 用户菜单
// ============================================================
(function () {
    function init() {
        const wrapper = document.querySelector('.user-menu-wrapper');
        const btn = document.getElementById('userMenuBtn');
        const dropdown = document.getElementById('userDropdown');
        if (!wrapper || !btn || !dropdown) return;

        let hoverTimer = null;
        wrapper.addEventListener('mouseenter', () => {
            if (hoverTimer) clearTimeout(hoverTimer);
            dropdown.classList.add('show');
        });
        wrapper.addEventListener('mouseleave', () => {
            hoverTimer = setTimeout(() => dropdown.classList.remove('show'), 250);
        });
        btn.addEventListener('click', () => {
            if (window.MY_UID) location.href = '/user/' + window.MY_UID;
        });
        dropdown.addEventListener('click', e => e.stopPropagation());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
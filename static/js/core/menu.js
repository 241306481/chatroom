// 用户菜单
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
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hoverTimer) clearTimeout(hoverTimer);
            dropdown.classList.toggle('show');
        });
        // 配合 stopPropagation，这里负责「点击外部关闭」
        dropdown.addEventListener('click', e => e.stopPropagation());
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) dropdown.classList.remove('show');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') dropdown.classList.remove('show');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
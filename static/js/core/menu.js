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
        // 点击必须能打开菜单。
        // 此前整个下拉只靠 CSS :hover 展开，click 处理器直接跳转个人资料：
        // 触屏与纯键盘操作下永远打不开（点一下 = 菜单闪一下就跳走），
        // 私信/安全设置/我的文件/退出登录全部无法触达。
        // 个人资料在下拉里本来就有（base.html 的 👤 个人资料），不会因此丢失。
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hoverTimer) clearTimeout(hoverTimer);
            dropdown.classList.toggle('show');
        });
        // 配合上面的 stopPropagation，这里负责「点击外部关闭」
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
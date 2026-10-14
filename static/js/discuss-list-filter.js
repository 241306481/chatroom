(function () {
    function init() {
        const input = document.querySelector('.list-filter-input');
        if (!input) return;
        // 筛选要作用在 .discuss-row-wrap（flex 行）上，而不是里面的
        // <a class="discuss-row">：只隐藏 <a> 的话，外层 wrap 仍占位，
        // 右侧的 .discuss-del-btn 还会被 .discuss-row-wrap:hover 规则点亮，
        // 于是一条已被筛掉的讨论仍占着空白并露出删除按钮。
        const rows = Array.from(document.querySelectorAll('.discuss-row-wrap'));
        if (!rows.length) return;
        const counter = document.querySelector('.list-filter-count');

        function apply() {
            const q = (input.value || '').toLowerCase().trim();
            let shown = 0;
            rows.forEach(el => {
                if (!q) { el.hidden = false; shown++; return; }
                const text = (el.textContent || '').toLowerCase();
                if (text.indexOf(q) >= 0) { el.hidden = false; shown++; }
                else el.hidden = true;
            });
            if (counter) counter.textContent = '筛选：' + shown + ' 项';
        }
        input.addEventListener('input', apply);
        apply();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

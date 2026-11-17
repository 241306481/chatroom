(function () {
    function init() {
        const input = document.querySelector('.list-filter-input');
        if (!input) return;
        if (!document.querySelector('[data-discuss-list]')) return;
        const counter = document.querySelector('.list-filter-count');
        function apply() {
            const q = (input.value || '').toLowerCase().trim();
            const rows = Array.from(document.querySelectorAll('.discuss-row-wrap'));
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
        window.DiscussListFilter = { refresh: apply };
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

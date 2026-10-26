(function () {
    function init() {
        const input = document.querySelector('.list-filter-input');
        if (!input) return;
        const table = document.querySelector('.user-table');
        if (!table) return;
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        const rows = Array.from(tbody.querySelectorAll('tr'));
        const counter = document.querySelector('.list-filter-count');
        function apply() {
            const q = (input.value || '').toLowerCase().trim();
            let shown = 0;
            rows.forEach(tr => {
                if (!q) {
                    tr.hidden = false;
                    shown++;
                    return;
                }
                const uid = tr.dataset.uid || '';
                const text = (tr.textContent || '').toLowerCase();
                if (text.indexOf(q) >= 0 || uid.indexOf(q) >= 0) {
                    tr.hidden = false;
                    shown++;
                } else {
                    tr.hidden = true;
                }
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

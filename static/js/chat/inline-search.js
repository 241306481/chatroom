(function () {
    function init() {
        const input = document.querySelector('.inline-search-input');
        if (!input) return;
        const closeBtn = document.querySelector('.inline-search-close');
        const counter = document.querySelector('.inline-search-count');
        function clearAll() {
            document.querySelectorAll('.message.inline-search-hit').forEach(el =>
                el.classList.remove('inline-search-hit'));
            if (counter) counter.textContent = '';
            if (closeBtn) closeBtn.hidden = true;
        }
        function apply() {
            clearAll();
            const q = (input.value || '').toLowerCase().trim();
            if (!q) return;
            const msgs = document.querySelectorAll('.message .msg-content:not(.msg-revoked)');
            let hit = 0;
            msgs.forEach(el => {
                const text = (el.textContent || '').toLowerCase();
                const wrap = el.closest('.message');
                if (text.indexOf(q) >= 0) {
                    if (wrap) wrap.classList.add('inline-search-hit');
                    hit++;
                }
            });
            if (counter) counter.textContent = hit ? hit + ' 条命中' : '无匹配';
            if (closeBtn) closeBtn.hidden = false;
        }
        input.addEventListener('input', apply);
        window.__chatSearchReapply = function () {
            if ((input.value || '').trim()) apply();
        };
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                input.value = '';
                clearAll();
            });
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

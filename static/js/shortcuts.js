(function () {
    function editing(target) {
        if (!target) return false;
        const tag = String(target.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select'
            || target.isContentEditable;
    }
    function focusSearch() {
        const input = document.querySelector(
            '.inline-search-input, #dmSearchInput, input[type="search"]');
        if (!input) return false;
        input.focus();
        if (typeof input.select === 'function' && input.value) input.select();
        return true;
    }
    document.addEventListener('keydown', function (e) {
        if (e.defaultPrevented || editing(e.target)) return;
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                location.href = '/messages';
                return;
            }
            if (e.key === 'f' || e.key === 'F') {
                if (focusSearch()) e.preventDefault();
                return;
            }
        }
        if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (window.showToast) {
                window.showToast('快捷键：Alt+M 私信，Alt+F 搜索，Ctrl+Enter 发送');
            }
        }
    });
})();

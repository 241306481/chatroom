// 预览与字数
window.EditorPreview = {
    attach({ root, ta, preview, counter, wrapper }) {
        function render() {
            if (wrapper && wrapper.classList.contains('md-editor-preview-hidden')) return;
            const text = ta.value.trim();
            if (!text) { preview.innerHTML = ''; return; }
            preview.innerHTML = window.renderContent
                ? window.renderContent(ta.value)
                : esc(ta.value).replace(/\n/g, '<br>');
        }

        function updateCounter() {
            if (counter) counter.textContent = String(ta.value.length);
        }

        function refresh() {
            render();
            updateCounter();
        }

        ta.addEventListener('input', refresh);
        refresh();

        return { render, refresh, updateCounter };
    },
};
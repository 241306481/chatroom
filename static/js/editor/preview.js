// ============================================================
// 预览渲染 + 字数统计
// ============================================================
window.EditorPreview = {
    attach({ root, ta, preview, counter, wrapper }) {
        function render() {
            if (wrapper && wrapper.classList.contains('md-editor-preview-hidden')) return;
            const text = ta.value.trim();
            if (!text) { preview.innerHTML = ''; return; }
            preview.innerHTML = window.renderContent ? window.renderContent(ta.value) : text;
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
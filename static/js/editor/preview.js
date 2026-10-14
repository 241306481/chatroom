// ============================================================
// 预览渲染 + 字数统计
// ============================================================
window.EditorPreview = {
    attach({ root, ta, preview, counter, wrapper }) {
        function render() {
            if (wrapper && wrapper.classList.contains('md-editor-preview-hidden')) return;
            const text = ta.value.trim();
            if (!text) { preview.innerHTML = ''; return; }
            // renderContent 未加载时的兜底分支必须转义。
            // 直接 innerHTML = text 会把原始输入当作 HTML 执行：编辑器正文是
            // 攻击者可控的（公告、消息编辑），<img src=x onerror=...> 会在
            // 每次 input 事件时运行。core/dom.js 的同一处兜底正是用 esc()。
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
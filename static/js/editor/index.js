// ============================================================
// Markdown 编辑器初始化
// ============================================================
(function () {

    window.initContextEdit = function (root) {
        if (typeof root === 'string') root = document.querySelector(root);
        if (!root || root.dataset.ctxInit === '1') return;
        root.dataset.ctxInit = '1';

        const ta = root.querySelector('textarea');
        const preview = root.querySelector('.md-editor-preview');
        const counter = root.querySelector('.md-editor-counter');
        const syncCb = root.querySelector('.md-editor-sync');
        const previewBtn = root.querySelector('[data-action="toggle-preview"]');
        const wrapper = root.querySelector('[data-wrapper]');
        const resizeOp = root.querySelector('[data-resize]');
        const heightResize = root.querySelector('[data-height-resize]');
        const paneEdit = root.querySelector('[data-pane="edit"]');
        const panePreview = root.querySelector('[data-pane="preview"]');
        if (!ta || !preview) return;

        // 预览
        if (window.MentionPicker) window.MentionPicker.attach(ta);

        const previewApi = window.EditorPreview.attach({
            root, ta, preview, counter, wrapper,
        });

        // 工具栏 + 下拉菜单（返回 closeAll 供表格选择器复用）
        const { closeAll } = window.EditorToolbar.attach({
            root, ta, refresh: previewApi.refresh,
        });

        // 表格选择器
        window.EditorTable.attach({
            root, ta, refresh: previewApi.refresh, closeAll,
        });

        // 尺寸拖拽
        window.EditorResize.attach({
            root, wrapper, resizeOp, paneEdit, panePreview, heightResize,
        });

        // 预览开关按钮
        if (previewBtn) {
            previewBtn.addEventListener('click', e => {
                e.stopPropagation();
                const hidden = wrapper.classList.toggle('md-editor-preview-hidden');
                previewBtn.classList.toggle('md-editor-toolbar-active', !hidden);
                if (!hidden) previewApi.refresh();
            });
        }

        // 同步滚动
        if (syncCb) {
            let syncLock = 0;
            function syncScroll(from, to) {
                if (!syncCb.checked) return;
                if (from.offsetParent === null || to.offsetParent === null) return;
                if (syncLock) return;
                const maxFrom = from.scrollHeight - from.clientHeight;
                const maxTo = to.scrollHeight - to.clientHeight;
                if (maxFrom <= 0 || maxTo <= 0) return;
                syncLock = 1;
                const pct = from.scrollTop / maxFrom;
                to.scrollTop = pct * maxTo;
                requestAnimationFrame(() => { syncLock = 0; });
            }
            ta.addEventListener('scroll', () => syncScroll(ta, preview));
            preview.addEventListener('scroll', () => syncScroll(preview, ta));
        }
    };

    function autoInit() {
        document.querySelectorAll('[data-context-edit]').forEach(el =>
            window.initContextEdit(el));
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoInit);
    } else {
        autoInit();
    }
})();
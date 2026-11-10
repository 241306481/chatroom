(function () {
    function draftEnabled() {
        return /^\/messages(?:$|\/|\?)/.test(location.pathname + location.search)
            || /\/discuss\//.test(location.pathname);
    }
    function draftKey(ta) {
        return 'chatroom-draft:' + location.pathname + location.search
            + ':' + (ta.id || 'editor');
    }
    function readDraft(key) {
        try { return localStorage.getItem(key) || ''; }
        catch (e) { return ''; }
    }
    function writeDraft(key, value) {
        try {
            if (value.trim()) localStorage.setItem(key, value);
            else localStorage.removeItem(key);
        } catch (e) {}
    }
    function bindDraft(root, ta, previewApi) {
        if (!draftEnabled()) return;
        const key = draftKey(ta);
        const saved = readDraft(key);
        if (saved && !ta.value) {
            ta.value = saved;
            if (previewApi && previewApi.refresh) previewApi.refresh();
        }
        let timer = null;
        ta.addEventListener('input', () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => writeDraft(key, ta.value), 400);
        });
        window.addEventListener('beforeunload', () => writeDraft(key, ta.value));
    }
    window.initContextEdit = function (root) {
        if (typeof root === 'string') root = document.querySelector(root);
        if (!root || root.dataset.ctxInit === '1') return;
        const ta = root.querySelector('textarea');
        const preview = root.querySelector('.md-editor-preview');
        const counter = root.querySelector('.md-editor-counter');
        const lineNumbers = root.querySelector('[data-line-numbers]');
        const lineCount = root.querySelector('[data-line-count]');
        const syncCb = root.querySelector('.md-editor-sync');
        const modeBtns = Array.from(
            root.querySelectorAll('[data-action="mode"]'));
        const wrapper = root.querySelector('[data-wrapper]');
        const resizeOp = root.querySelector('[data-resize]');
        const heightResize = root.querySelector('[data-height-resize]');
        const paneEdit = root.querySelector('[data-pane="edit"]');
        const panePreview = root.querySelector('[data-pane="preview"]');
        if (!ta || !preview) return;
        root.dataset.ctxInit = '1';
        if (window.MentionPicker) window.MentionPicker.attach(ta);
        const previewApi = window.EditorPreview.attach({
            root, ta, preview, counter, lineNumbers, lineCount, wrapper,
        });
        const { closeAll } = window.EditorToolbar.attach({
            root, ta, refresh: previewApi.refresh,
        });
        ta.addEventListener('paste', e => {
            const data = e.clipboardData;
            if (!data) return;
            const isImage = file => file && (/^image\//i.test(file.type)
                || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name || ''));
            let files = Array.from(data.items || [])
                .filter(item => item.kind === 'file')
                .map(item => {
                    try { return item.getAsFile(); } catch (err) { return null; }
                })
                .filter(isImage);
            if (!files.length) files = Array.from(data.files || []).filter(isImage);
            if (!files.length) return;
            e.preventDefault();
            if (!window.EditorUpload) return;
            window.EditorUpload.pasteFiles(files, ta, previewApi.refresh, {
                kind: 'image', visibility: root.dataset.imageVisibility,
            });
        });
        let dragDepth = 0;
        root.addEventListener('dragenter', e => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
            e.preventDefault();
            dragDepth += 1;
            root.classList.add('md-drag-over');
        });
        root.addEventListener('dragover', e => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        root.addEventListener('dragleave', () => {
            dragDepth = Math.max(0, dragDepth - 1);
            if (!dragDepth) root.classList.remove('md-drag-over');
        });
        root.addEventListener('drop', e => {
            if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
            e.preventDefault();
            dragDepth = 0;
            root.classList.remove('md-drag-over');
            if (!window.EditorUpload || !window.EditorUpload.dropFiles) return;
            window.EditorUpload.dropFiles(e.dataTransfer.files, ta, previewApi.refresh, {
                visibility: root.dataset.imageVisibility,
            });
        });
        bindDraft(root, ta, previewApi);
        window.EditorTable.attach({
            root, ta, refresh: previewApi.refresh, closeAll,
        });
        window.EditorResize.attach({
            root, wrapper, resizeOp, paneEdit, panePreview, heightResize,
        });
        if (modeBtns.length) {
            function setMode(mode) {
                if (['source', 'split', 'preview'].indexOf(mode) < 0) mode = 'split';
                root.dataset.editorMode = mode;
                wrapper.classList.toggle('md-editor-preview-hidden', mode === 'source');
                wrapper.classList.toggle('md-editor-edit-hidden', mode === 'preview');
                modeBtns.forEach(btn =>
                    btn.classList.toggle('md-editor-toolbar-active',
                        btn.dataset.mode === mode));
                if (mode !== 'source') previewApi.refresh();
            }
            modeBtns.forEach(btn => btn.addEventListener('click', e => {
                e.stopPropagation();
                setMode(btn.dataset.mode);
            }));
            setMode(root.dataset.editorMode || 'split');
        }
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

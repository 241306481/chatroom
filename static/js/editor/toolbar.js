window.EditorToolbar = {
    attach({ root, ta, refresh }) {
        const closeAll = () => window.EditorUtils.closeAll(root);
        root.querySelectorAll('[data-action="dropdown"]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const name = btn.dataset.menu;
                const dd = root.querySelector('.md-editor-dropdown[data-menu-id="' + name + '"]');
                if (!dd) return;
                const hidden = dd.classList.contains('md-editor-dropdown-hidden');
                closeAll();
                if (hidden) {
                    const r = btn.getBoundingClientRect();
                    dd.style.position = 'fixed';
                    dd.style.left = r.left + 'px';
                    dd.style.top = (r.bottom + 4) + 'px';
                    dd.classList.remove('md-editor-dropdown-hidden');
                    btn.classList.add('md-editor-toolbar-active');
                }
            });
        });
        document.addEventListener('click', closeAll);
        root.querySelectorAll('[data-action]').forEach(el => {
            const action = el.dataset.action;
            if (action === 'dropdown' || action === 'mode') return;
            el.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                handleAction(action, el, ta, refresh);
                closeAll();
                refresh();
            });
        });
        ta.addEventListener('keydown', e => {
            if (!(e.ctrlKey || e.metaKey)) return;
            const U = window.EditorUtils;
            if (e.key === 'b' || e.key === 'B') { e.preventDefault(); U.surround(ta, '**', '**'); refresh(); }
            else if (e.key === 'i' || e.key === 'I') { e.preventDefault(); U.surround(ta, '*', '*'); refresh(); }
            else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); U.surround(ta, '<u>', '</u>'); refresh(); }
        });
        window.addEventListener('scroll', closeAll, true);
        window.addEventListener('resize', closeAll);
        return { closeAll };
    },
};
function handleAction(action, el, ta, refresh) {
    const U = window.EditorUtils;
    if (action === 'wrap') {
        U.surround(ta, el.dataset.before || '', el.dataset.after || '', el.dataset.placeholder || '');
    } else if (action === 'prefix') {
        U.togglePrefix(ta, el.dataset.prefix || '');
    } else if (action === 'codeblock') {
        U.wrapCode(ta);
    } else if (action === 'katex-block') {
        U.wrapKatexBlock(ta);
    } else if (action === 'link') {
        window.showPrompt('链接地址', 'https://', { title: '插入链接' }).then(function (url) {
            if (!url) return;
            const s = ta.selectionStart, e = ta.selectionEnd;
            const sel = ta.value.substring(s, e) || '文字';
            U.insertAt(ta, '[' + sel + '](' + url + ') ');
            refresh();
        });
    } else if (action === 'image-link') {
        window.showPrompt('图片地址', 'https://', { title: '插入图片' }).then(function (url) {
            if (url) {
                U.insertAt(ta, '![](' + url + ')');
                refresh();
            }
        });
    } else if (action === 'image-upload') {
        if (window.EditorUpload) {
            const root = el.closest('.md-editor');
            const visibility = root && root.dataset.imageVisibility;
            window.EditorUpload.pickAndUpload(ta, refresh,
                { kind: 'image', visibility });
        }
    } else if (action === 'file-upload') {
        if (window.EditorUpload) {
            const root = el.closest('.md-editor');
            const visibility = root && root.dataset.imageVisibility;
            window.EditorUpload.pickAndUpload(ta, refresh,
                { kind: 'file', visibility });
        }
    } else if (action === 'undo') {
        ta.focus();
        try { document.execCommand('undo'); } catch (e) {}
    } else if (action === 'redo') {
        ta.focus();
        try { document.execCommand('redo'); } catch (e) {}
    }
}

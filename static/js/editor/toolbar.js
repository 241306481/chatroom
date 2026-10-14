// ============================================================
// 工具栏 + 下拉菜单 + 键盘快捷键
// ============================================================
window.EditorToolbar = {
    attach({ root, ta, refresh }) {
        const closeAll = () => window.EditorUtils.closeAll(root);

        // ---------- 下拉菜单开合 ----------
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

        // ---------- 普通动作按钮 ----------
        root.querySelectorAll('[data-action]').forEach(el => {
            const action = el.dataset.action;
            if (action === 'dropdown' || action === 'toggle-preview') return;

            el.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                handleAction(action, el, ta, refresh);
                closeAll();
                refresh();
            });
        });

        // ---------- 键盘快捷键 ----------
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

// ============================================================
// 单个 action 处理
// ============================================================
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
            // 必须走 U.insertAt：直接给 ta.value 赋值会把选区折叠到整个文档末尾，
            // 于是光标跳到最末尾，紧接着点下一个工具栏按钮就会改错文本。
            // insertAt 会把光标还原到插入内容之后。
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
            window.EditorUpload.pickAndUpload(ta, refresh);
        }
    } else if (action === 'undo') {
        ta.focus();
        try { document.execCommand('undo'); } catch (e) {}
    } else if (action === 'redo') {
        ta.focus();
        try { document.execCommand('redo'); } catch (e) {}
    }
}
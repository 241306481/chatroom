// ============================================================
// 编辑器尺寸拖拽（水平 + 垂直）
// ============================================================
window.EditorResize = {
    attach({ root, wrapper, resizeOp, paneEdit, panePreview, heightResize }) {
        // 拖拽结束必须有多余的触发路径。
        // 只监听 document 的 mouseup 时，如果在浏览器窗口外（浏览器边框、
        // 另一个程序）松开按钮，mouseup 不会派发到文档：dragging 会一直是
        // true，document.body 保留 cursor:col-resize 与 user-select:none，
        // 此后每一次无按键的 mousemove 都会继续改布局，页面直到某次
        // 窗口内的点击才恢复。blur / pointercancel 补上这两条缺口。
        function endDrag() {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

        // ---------- 水平拖动（编辑区/预览区分割线） ----------
        if (resizeOp && paneEdit && panePreview) {
            let dragging = false;
            resizeOp.addEventListener('mousedown', e => {
                dragging = true;
                e.preventDefault();
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            });
            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                const rect = wrapper.getBoundingClientRect();
                let pct = (e.clientX - rect.left) / rect.width;
                pct = Math.max(0.15, Math.min(0.85, pct));
                paneEdit.style.flex = pct + ' 1 0';
                panePreview.style.flex = (1 - pct) + ' 1 0';
            });
            const stopH = () => {
                if (!dragging) return;
                dragging = false;
                endDrag();
            };
            document.addEventListener('mouseup', stopH);
            window.addEventListener('blur', stopH);
        }

        // ---------- 垂直拖动（改变编辑器总高度） ----------
        if (heightResize) {
            let dragging = false;
            let startY = 0, startH = 0;
            const isTop = heightResize.dataset.heightResizePos === 'top';

            heightResize.addEventListener('mousedown', e => {
                dragging = true;
                startY = e.clientY;
                startH = wrapper.getBoundingClientRect().height;
                e.preventDefault();
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';
            });
            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                const delta = e.clientY - startY;
                const raw = isTop ? startH - delta : startH + delta;
                const newH = Math.max(120, Math.min(1000, raw));
                root.style.setProperty('--md-editor-height', newH + 'px');
            });
            const stopV = () => {
                if (!dragging) return;
                dragging = false;
                endDrag();
            };
            document.addEventListener('mouseup', stopV);
            window.addEventListener('blur', stopV);
        }
    },
};
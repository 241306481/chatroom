// 编辑器拖拽
window.EditorResize = {
    attach({ root, wrapper, resizeOp, paneEdit, panePreview, heightResize }) {
        function endDrag() {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }

// 水平拖动
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

// 垂直拖动
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
window.EditorResize = {
    attach({ root, wrapper, resizeOp, paneEdit, panePreview, heightResize, keepTop }) {
        function endDrag() {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
        function scrollParent(el) {
            let p = el.parentElement;
            while (p) {
                const style = getComputedStyle(p);
                if (/(auto|scroll)/.test(style.overflowY)) return p;
                p = p.parentElement;
            }
            return document.scrollingElement;
        }
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
        if (heightResize) {
            let dragging = false;
            let startY = 0, startH = 0;
            let keep = null;
            const isTop = heightResize.dataset.heightResizePos === 'top';
            heightResize.addEventListener('mousedown', e => {
                dragging = true;
                startY = e.clientY;
                startH = wrapper.getBoundingClientRect().height;
                if (keepTop) {
                    const scroller = scrollParent(root);
                    if (scroller) {
                        keep = {
                            scroller,
                            top: root.getBoundingClientRect().top,
                            anchor: scroller.style.overflowAnchor,
                        };
                        scroller.style.overflowAnchor = 'none';
                    }
                }
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
                if (keep) {
                    const shift = root.getBoundingClientRect().top - keep.top;
                    if (shift) keep.scroller.scrollTop += shift;
                }
            });
            const stopV = () => {
                if (!dragging) return;
                dragging = false;
                if (keep) {
                    keep.scroller.style.overflowAnchor = keep.anchor;
                    keep = null;
                }
                endDrag();
            };
            document.addEventListener('mouseup', stopV);
            window.addEventListener('blur', stopV);
        }
    },
};

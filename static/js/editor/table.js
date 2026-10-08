// ============================================================
// 表格形状选择器
// ============================================================
window.EditorTable = {
    attach({ root, ta, refresh, closeAll }) {
        const shape = root.querySelector('[data-table-shape]');
        const shapeInfo = root.querySelector('[data-table-shape-info]');
        if (!shape) return;

        const cells = Array.from(shape.querySelectorAll('.md-editor-table-shape-col'));
        let picked = { rows: 0, cols: 0 };

        cells.forEach(cell => {
            cell.addEventListener('mouseenter', () => {
                const r = parseInt(cell.dataset.row, 10);
                const c = parseInt(cell.dataset.col, 10);
                picked = { rows: r, cols: c };
                cells.forEach(x => {
                    const xr = parseInt(x.dataset.row, 10);
                    const xc = parseInt(x.dataset.col, 10);
                    x.classList.toggle('active', xr <= r && xc <= c);
                });
                if (shapeInfo) shapeInfo.textContent = c + ' × ' + r;
            });

            cell.addEventListener('click', e => {
                e.stopPropagation();
                if (picked.rows && picked.cols) {
                    window.EditorUtils.insertTable(ta, picked.rows, picked.cols);
                    closeAll();
                    refresh();
                }
            });
        });

        shape.addEventListener('mouseleave', () => {
            cells.forEach(x => x.classList.remove('active'));
            if (shapeInfo) shapeInfo.textContent = '1 × 1';
            picked = { rows: 0, cols: 0 };
        });
    },
};
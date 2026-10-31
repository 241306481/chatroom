(function () {
    function scopeOf(el) {
        return el.closest('[data-batch-scope]') || document;
    }
    function selected(scope) {
        return Array.from(scope.querySelectorAll('[data-batch-check]'))
            .filter(el => el.checked)
            .map(el => el.value)
            .filter(Boolean);
    }
    function updateCount(scope) {
        const boxes = Array.from(scope.querySelectorAll('[data-batch-check]'));
        const count = boxes.filter(el => el.checked).length;
        scope.querySelectorAll('[data-batch-count]').forEach(el => {
            el.textContent = '已选 ' + count + ' 个';
        });
        const all = scope.querySelector('[data-batch-all]');
        if (all) all.checked = boxes.length > 0 && count === boxes.length;
    }
    function updateScopes(el) {
        document.querySelectorAll('[data-batch-scope]').forEach(updateCount);
        if (el && el.closest) updateCount(scopeOf(el));
    }
    document.addEventListener('change', function (e) {
        const all = e.target && e.target.closest
            ? e.target.closest('[data-batch-all]') : null;
        if (all) {
            const scope = scopeOf(all);
            scope.querySelectorAll('[data-batch-check]').forEach(el => {
                el.checked = all.checked;
            });
        }
        if (e.target && (e.target.matches('[data-batch-check]')
            || e.target.matches('[data-batch-all]'))) {
            updateScopes(e.target);
        }
    });
    document.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest
            ? e.target.closest('[data-batch-action]') : null;
        if (!btn || !btn.form) return;
        const field = btn.form.querySelector('[data-batch-action-field]');
        if (field) field.value = btn.dataset.batchAction || '';
        if (btn.dataset.batchVisibility) {
            const visibility = btn.form.querySelector('input[name="visibility"]');
            if (visibility) visibility.value = btn.dataset.batchVisibility;
        }
    });
    document.addEventListener('submit', function (e) {
        const form = e.target;
        if (!form || !form.matches || !form.matches('[data-batch-form]')) return;
        const scope = scopeOf(form);
        const ids = selected(scope);
        if (!ids.length) {
            e.preventDefault();
            e.stopPropagation();
            if (window.showAlert) window.showAlert('请先选择项目');
            return;
        }
        const field = form.querySelector('[data-batch-ids]');
        if (field) field.value = ids.join(',');
    }, true);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            document.querySelectorAll('[data-batch-scope]').forEach(updateCount);
        });
    } else {
        document.querySelectorAll('[data-batch-scope]').forEach(updateCount);
    }
})();

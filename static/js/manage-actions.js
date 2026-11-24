(function () {
    function field(form, selector, name) {
        let el = form.querySelector(selector);
        if (el) return el;
        el = document.createElement('input');
        el.type = 'hidden';
        el.name = name;
        el.setAttribute(selector.replace(/^\[|\]$/g, ''), '');
        form.appendChild(el);
        return el;
    }
    function fill(form, result, kind) {
        if (kind === 'mute') {
            const minutes = field(form, '[data-duration-minutes]', 'minutes');
            minutes.value = String(result.minutes || 60);
            return;
        }
        const until = field(form, '[data-duration-until]', 'until');
        until.value = result.until || '';
        if (result.reason) {
            const reason = form.querySelector('[data-duration-reason]')
                || form.querySelector('input[name="reason"]');
            if (reason && !reason.value) reason.value = result.reason;
        }
    }
    document.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest
            ? e.target.closest('[data-duration-action]') : null;
        if (!btn) return;
        const form = btn.closest('form');
        if (!form || !window.showDurationPicker) return;
        e.preventDefault();
        e.stopPropagation();
        const kind = btn.dataset.kind || form.dataset.kind || 'ban';
        const name = btn.dataset.name || '';
        const message = kind === 'mute'
            ? (name ? '为 ' + name + ' 选择禁言时长' : '请选择禁言时长')
            : (name ? '为 ' + name + ' 选择封禁时长' : '请选择封禁时长');
        const promptReason = form.dataset.reasonPrompt !== '0';
        window.showDurationPicker({
            kind: kind,
            message: message,
            reason: kind === 'ban' && promptReason,
        }).then(function (result) {
            if (!result) return;
            fill(form, result, kind);
            if (btn.dataset.batchAction) {
                const actionField = form.querySelector('[data-batch-action-field]');
                if (actionField) actionField.value = btn.dataset.batchAction;
            }
            if (typeof form.requestSubmit === 'function') form.requestSubmit(btn);
            else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        });
    }, true);
})();

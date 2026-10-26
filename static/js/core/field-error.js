'use strict';
window.FieldError = (function () {
    const EPS = '\u203a';
    function boxOf(input) {
        if (!input.dataset.errorBox) {
            const b = document.createElement('div');
            b.className = 'field-error';
            b.hidden = true;
            b.setAttribute('role', 'alert');
            input.insertAdjacentElement('afterend', b);
            input.dataset.errorBox = '1';
            return b;
        }
        let n = input.nextElementSibling;
        while (n && !n.classList.contains('field-error')) n = n.nextElementSibling;
        return n;
    }
    function show(input, msg) {
        const b = boxOf(input);
        if (!b) return;
        b.textContent = msg ? EPS + ' ' + msg : '';
        b.hidden = !msg;
        if (msg) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
    }
    function clear(input) { show(input, ''); }
    function attach(input, check) {
        if (!input) return;
        boxOf(input);
        const run = () => {
            try { show(input, check(input.value, input)); }
            catch (e) { show(input, ''); }
        };
        input.addEventListener('input', run);
        input.addEventListener('blur', run);
        if (input.value) run();
    }
    function bindAll(root) {
        (root || document).querySelectorAll('[data-error-check]').forEach((el) => {
            if (el.dataset.errorBound) return;
            el.dataset.errorBound = '1';
            const fn = window[el.dataset.errorCheck];
            if (typeof fn === 'function') attach(el, fn);
        });
    }
    function fromQuery(sel) {
        const err = new URL(location.href).searchParams.get('error');
        if (!err) return;
        const el = document.querySelector(sel || '[data-error-box]');
        if (el) { el.textContent = EPS + ' ' + err; el.hidden = false; }
    }
    return { attach, bindAll, show, clear, fromQuery };
})();
document.addEventListener('DOMContentLoaded', function () {
    window.FieldError.bindAll(document);
});

'use strict';
// 输入框下方的即时红字提示。
// 用法：input 挂 data-error-check="fnName"，自动建提示行
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
        // 已建过，重新取（避免跨页面缓存失效）
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

    // check(value, input) 返回错误文案或空串
    function attach(input, check) {
        if (!input) return;
        boxOf(input);
        const run = () => {
            try { show(input, check(input.value, input)); }
            catch (e) { show(input, ''); }
        };
        input.addEventListener('input', run);
        input.addEventListener('blur', run);
        // 初始为空时不红，等用户输入
        if (input.value) run();
    }

    // 批量绑定带 data-error-check 的输入
    function bindAll(root) {
        (root || document).querySelectorAll('[data-error-check]').forEach((el) => {
            if (el.dataset.errorBound) return;
            el.dataset.errorBound = '1';
            const fn = window[el.dataset.errorCheck];
            if (typeof fn === 'function') attach(el, fn);
        });
    }

    // 落地服务端返回的 ?error=
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
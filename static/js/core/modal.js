// ============================================================
// 内联弹窗（替代原生 alert / confirm / prompt）
// ============================================================
(function () {
    let root = null;

    function getRoot() {
        if (!root || !document.body.contains(root)) {
            root = document.createElement('div');
            root.id = 'modalRoot';
            document.body.appendChild(root);
        }
        return root;
    }

    function open(cfg) {
        return new Promise(function (resolve) {
            const container = getRoot();
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';

            const box = document.createElement('div');
            box.className = 'modal-box' + (cfg.danger ? ' modal-danger' : '');
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');

            // ---- 头部 ----
            const header = document.createElement('div');
            header.className = 'modal-header';
            const iconEl = document.createElement('span');
            iconEl.className = 'modal-icon';
            iconEl.textContent = cfg.danger ? '⚠' : (cfg.type === 'prompt' ? '✎' : '💬');
            header.appendChild(iconEl);
            const titleEl = document.createElement('span');
            titleEl.className = 'modal-title';
            titleEl.textContent = cfg.title || (cfg.type === 'prompt' ? '输入' : '提示');
            header.appendChild(titleEl);
            box.appendChild(header);

            // ---- 主体 ----
            const body = document.createElement('div');
            body.className = 'modal-body';
            const msgEl = document.createElement('div');
            msgEl.className = 'modal-message';
            msgEl.textContent = cfg.message == null ? '' : String(cfg.message);
            body.appendChild(msgEl);

            let input = null;
            if (cfg.type === 'prompt') {
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'modal-input';
                input.value = cfg.value == null ? '' : String(cfg.value);
                if (cfg.placeholder) input.placeholder = cfg.placeholder;
                body.appendChild(input);
            }
            box.appendChild(body);

            // ---- 底部 ----
            const footer = document.createElement('div');
            footer.className = 'modal-footer';
            let cancelBtn = null;
            if (cfg.type !== 'alert') {
                cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'modal-btn modal-btn-cancel';
                cancelBtn.textContent = cfg.cancelText || '取消';
                footer.appendChild(cancelBtn);
            }
            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'modal-btn modal-btn-ok' + (cfg.danger ? ' danger' : '');
            okBtn.textContent = cfg.okText || '确定';
            footer.appendChild(okBtn);
            box.appendChild(footer);

            overlay.appendChild(box);
            container.appendChild(overlay);
            requestAnimationFrame(function () { overlay.classList.add('show'); });

            // ---- 关闭逻辑 ----
            let done = false;
            function cancelValue() {
                return cfg.type === 'prompt' ? null : cfg.type === 'confirm' ? false : true;
            }
            function close(result) {
                if (done) return;
                done = true;
                document.removeEventListener('keydown', onKey, true);
                overlay.classList.remove('show');
                setTimeout(function () {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }, 200);
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault(); e.stopPropagation();
                    close(cancelValue());
                } else if (e.key === 'Enter') {
                    if (cfg.type === 'prompt') {
                        e.preventDefault();
                        close(input.value);
                    } else if (document.activeElement === okBtn) {
                        e.preventDefault();
                        close(true);
                    }
                }
            }
            okBtn.addEventListener('click', function () {
                close(cfg.type === 'prompt' ? input.value : true);
            });
            if (cancelBtn) {
                cancelBtn.addEventListener('click', function () { close(cancelValue()); });
            }
            overlay.addEventListener('mousedown', function (e) {
                if (e.target === overlay) close(cancelValue());
            });
            document.addEventListener('keydown', onKey, true);

            setTimeout(function () {
                if (input) { input.focus(); input.select(); }
                else okBtn.focus();
            }, 40);
        });
    }

    // ---- 对外 API ----
    window.showModal = open;
    window.showAlert = function (message, opts) {
        return open(Object.assign({ type: 'alert', message: message }, opts || {}));
    };
    window.showConfirm = function (message, opts) {
        return open(Object.assign({ type: 'confirm', message: message, danger: true }, opts || {}));
    };
    window.showPrompt = function (message, value, opts) {
        return open(Object.assign({ type: 'prompt', message: message, value: value }, opts || {}));
    };

    // ---- 全局 data-confirm 拦截 ----
    document.addEventListener('click', function (e) {
        const el = e.target && e.target.closest ? e.target.closest('[data-confirm]') : null;
        if (!el) return;
        if (el.dataset.confirmPass === '1') {
            delete el.dataset.confirmPass;
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        window.showConfirm(el.dataset.confirm, { danger: true }).then(function (ok) {
            if (!ok) return;
            el.dataset.confirmPass = '1';
            el.click();
        });
    }, true);
})();
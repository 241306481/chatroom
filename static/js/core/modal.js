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
    window.showDurationPicker = function (cfg) {
        cfg = cfg || {};
        const kind = cfg.kind === 'mute' ? 'mute' : 'ban';
        const isMute = kind === 'mute';
        return new Promise(function (resolve) {
            const container = getRoot();
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            const box = document.createElement('div');
            box.className = 'modal-box duration-box' + (isMute ? '' : ' modal-danger');
            box.setAttribute('role', 'dialog');
            box.setAttribute('aria-modal', 'true');
            const header = document.createElement('div');
            header.className = 'modal-header';
            const iconEl = document.createElement('span');
            iconEl.className = 'modal-icon';
            iconEl.textContent = isMute ? '🔇' : '⚠';
            header.appendChild(iconEl);
            const titleEl = document.createElement('span');
            titleEl.className = 'modal-title';
            titleEl.textContent = cfg.title || (isMute ? '禁言时长' : '封禁时长');
            header.appendChild(titleEl);
            box.appendChild(header);
            const body = document.createElement('div');
            body.className = 'modal-body';
            const msgEl = document.createElement('div');
            msgEl.className = 'modal-message';
            msgEl.textContent = cfg.message || '请选择本次操作的时长';
            body.appendChild(msgEl);
            const presets = isMute
                ? [[10, '10 分钟'], [60, '1 小时'], [1440, '1 天'],
                    [10080, '7 天'], [43200, '30 天'], ['custom', '自定义']]
                : [[60, '1 小时'], [1440, '1 天'], [10080, '7 天'],
                    [43200, '30 天'], [0, '永久'], ['custom', '自定义']];
            let selected = isMute ? 60 : 1440;
            let customMode = false;
            const grid = document.createElement('div');
            grid.className = 'duration-presets';
            const buttons = [];
            presets.forEach(function (item) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'duration-option';
                btn.textContent = item[1];
                btn.dataset.value = String(item[0]);
                if (item[0] === selected) btn.classList.add('active');
                btn.addEventListener('click', function () {
                    buttons.forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    if (item[0] === 'custom') {
                        customMode = true;
                        customWrap.hidden = false;
                        setTimeout(function () {
                            (isMute ? customInput : dateInput).focus();
                        }, 20);
                    } else {
                        customMode = false;
                        selected = Number(item[0]);
                        customWrap.hidden = true;
                    }
                });
                buttons.push(btn);
                grid.appendChild(btn);
            });
            body.appendChild(grid);
            const customWrap = document.createElement('div');
            customWrap.className = 'duration-custom';
            customWrap.hidden = true;
            const customLabel = document.createElement('label');
            customLabel.textContent = isMute ? '自定义分钟数' : '到期时间（留空为永久）';
            let customInput = null;
            let dateInput = null;
            if (isMute) {
                customInput = document.createElement('input');
                customInput.type = 'number';
                customInput.min = '1';
                customInput.max = '43200';
                customInput.value = '60';
                customInput.className = 'modal-input';
            } else {
                dateInput = document.createElement('input');
                dateInput.type = 'datetime-local';
                dateInput.className = 'modal-input';
            }
            customLabel.appendChild(isMute ? customInput : dateInput);
            customWrap.appendChild(customLabel);
            body.appendChild(customWrap);
            let reasonInput = null;
            if (!isMute && cfg.reason !== false) {
                const reasonLabel = document.createElement('label');
                reasonLabel.textContent = '原因（可选）';
                reasonInput = document.createElement('input');
                reasonInput.type = 'text';
                reasonInput.maxLength = 200;
                reasonInput.className = 'modal-input';
                reasonInput.placeholder = '填写封禁原因';
                reasonLabel.appendChild(reasonInput);
                body.appendChild(reasonLabel);
            }
            box.appendChild(body);
            const footer = document.createElement('div');
            footer.className = 'modal-footer';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'modal-btn modal-btn-cancel';
            cancelBtn.textContent = cfg.cancelText || '取消';
            footer.appendChild(cancelBtn);
            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'modal-btn modal-btn-ok' + (isMute ? '' : ' danger');
            okBtn.textContent = cfg.okText || '确定';
            footer.appendChild(okBtn);
            box.appendChild(footer);
            overlay.appendChild(box);
            container.appendChild(overlay);
            requestAnimationFrame(function () { overlay.classList.add('show'); });
            let done = false;
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
            function untilIso(minutes) {
                return new Date(Date.now() + minutes * 60000)
                    .toISOString().replace(/\.\d{3}Z$/, 'Z');
            }
            function submit() {
                let minutes = 0;
                let until = '';
                if (customMode) {
                    if (isMute) {
                        minutes = parseInt(customInput.value, 10);
                        if (!minutes || minutes < 1) {
                            customInput.focus();
                            return;
                        }
                        minutes = Math.min(minutes, 43200);
                    } else if (dateInput.value) {
                        const d = new Date(dateInput.value);
                        if (Number.isNaN(d.getTime())) {
                            dateInput.focus();
                            return;
                        }
                        until = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
                    }
                } else if (isMute) {
                    minutes = selected;
                } else if (selected > 0) {
                    until = untilIso(selected);
                }
                close({
                    minutes: minutes,
                    until: until,
                    reason: reasonInput ? String(reasonInput.value || '').trim() : '',
                });
            }
            function onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault(); e.stopPropagation();
                    close(null);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                }
            }
            okBtn.addEventListener('click', submit);
            cancelBtn.addEventListener('click', function () { close(null); });
            overlay.addEventListener('mousedown', function (e) {
                if (e.target === overlay) close(null);
            });
            document.addEventListener('keydown', onKey, true);
            setTimeout(function () { okBtn.focus(); }, 40);
        });
    };
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

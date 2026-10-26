window.inlineEdit = function (el, opts) {
    opts = opts || {};
    if (el.dataset.editing === '1') return;
    el.dataset.editing = '1';
    const originalText = el.textContent;
    const originalValue = opts.value !== undefined ? opts.value : originalText.trim();
    const emptyText = opts.emptyText || '（空）';
    const hadEmptyClass = el.classList.contains('empty');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit-input';
    input.value = originalValue;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.maxLength) input.maxLength = opts.maxLength;
    const parent = el.parentNode;
    parent.replaceChild(input, el);
    input.focus();
    input.select();
    let finished = false;
    function finish(save) {
        if (finished) return;
        finished = true;
        const newValue = input.value.trim();
        parent.replaceChild(el, input);
        delete el.dataset.editing;
        if (!save || newValue === originalValue) {
            el.textContent = originalText;
            el.classList.toggle('empty', hadEmptyClass);
            return;
        }
        if (opts.pattern && !new RegExp('^' + opts.pattern + '$').test(newValue)) {
            window.showAlert(opts.patternError || '格式不正确');
            el.textContent = originalText;
            el.classList.toggle('empty', hadEmptyClass);
            return;
        }
        el.textContent = '保存中...';
        el.classList.add('saving');
        opts.onSave(newValue, function (ok, err) {
            el.classList.remove('saving');
            if (ok) {
                el.textContent = newValue || emptyText;
                el.dataset.value = newValue;
                el.classList.toggle('empty', !newValue);
            } else {
                el.textContent = originalText;
                el.classList.toggle('empty', hadEmptyClass);
                if (err) window.showAlert(err);
            }
        });
    }
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
};
window.inlineEditTitle = function (el) {
    const domain = window.__DOMAIN__ || '';
    const id = el.dataset.id;
    window.inlineEdit(el, {
        value: el.dataset.value || '',
        placeholder: '标题',
        maxLength: 100,
        emptyText: '（无标题）',
        onSave: function (value, cb) {
            const fd = new URLSearchParams();
            fd.append('title', value);
            fetch('/domain/' + encodeURIComponent(domain)
                + '/discuss/' + encodeURIComponent(id) + '/edit-title', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: fd.toString(),
            }).then(r => r.json()).then(res => {
                if (res.ok) cb(true); else cb(false, res.error);
            }).catch(() => cb(false, '网络错误'));
        },
    });
};
window.inlineEditId = function (el) {
    const domain = window.__DOMAIN__ || '';
    const oldId = el.dataset.oldId;
    window.inlineEdit(el, {
        value: oldId,
        placeholder: '讨论 ID',
        maxLength: 32,
        pattern: '[a-z0-9_-]{1,32}',
        patternError: '只能含小写字母、数字、下划线、短横线（1-32 位）',
        onSave: function (value, cb) {
            if (value === oldId) { cb(true); return; }
            const fd = new URLSearchParams();
            fd.append('new_id', value);
            fetch('/domain/' + encodeURIComponent(domain)
                + '/discuss/' + encodeURIComponent(oldId) + '/rename', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                },
                body: fd.toString(),
            }).then(r => r.json()).then(res => {
                if (!res.ok) { cb(false, res.error || '重命名失败'); return; }
                if (res.unchanged) { cb(true); return; }
                location.href = '/domain/' + encodeURIComponent(domain)
                    + '/discuss/' + encodeURIComponent(res.new_id);
            }).catch(err => cb(false, '网络错误：' + err.message));
        },
    });
};
window.inlineEditFilename = function (el) {
    const url = el.dataset.renameUrl;
    window.inlineEdit(el, {
        value: el.dataset.value || '',
        placeholder: '文件名',
        maxLength: 200,
        onSave: function (value, cb) {
            const fd = new URLSearchParams();
            fd.append('filename', value);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: fd.toString(),
            }).then(r => r.json()).then(res => {
                if (res.ok) cb(true); else cb(false, res.error);
            }).catch(() => cb(false, '网络错误'));
        },
    });
};

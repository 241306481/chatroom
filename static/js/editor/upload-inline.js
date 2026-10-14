// ============================================================
// 编辑器内联图片上传
// 域上下文 → 上传到域文件；否则 → 上传到用户文件
// ============================================================
(function () {
    function getUploadUrl() {
        const dn = window.__DOMAIN__;
        if (dn) return '/domain/' + encodeURIComponent(dn) + '/files/upload';
        // 不带 visibility=public：/myfile/upload 默认 private，
        // 而「我的文件」页的常规上传走的也是同一默认值。
        // 此前内联上传强制 public，同一张图从哪个界面传进去
        // 隐私级别就不同，是个静默的越权公开。
        return '/myfile/upload';
    }

    function getViewUrl(fileId) {
        const dn = window.__DOMAIN__;
        const uid = window.MY_UID || window.__CURRENT_UID__ || '';
        if (dn) return location.origin + '/domain/' + encodeURIComponent(dn) + '/files/' + fileId;
        return location.origin + '/myfile/' + encodeURIComponent(uid) + '/' + fileId;
    }

    window.EditorUpload = {
        pickAndUpload(ta, refresh) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.display = 'none';
            document.body.appendChild(input);

            // 用户取消系统文件对话框时不会触发 change，这个隐藏 input
            // 会永久留在 document 里。选完后窗口重新获得焦点，
            // 若仍未选中文件就说明是取消，清理掉。
            let settled = false;
            const cleanup = function () {
                if (settled) return;
                settled = true;
                input.remove();
                window.removeEventListener('focus', onFocusBack);
            };
            const onFocusBack = function () {
                // change 事件先于 focus 触发，所以这里读到 0 个文件即为取消
                setTimeout(function () {
                    if (!input.files || input.files.length === 0) cleanup();
                }, 300);
            };

            input.addEventListener('change', function () {
                const f = input.files && input.files[0];
                settled = true;
                input.remove();
                window.removeEventListener('focus', onFocusBack);
                if (!f) return;
                window.EditorUpload._upload(f, ta, refresh);
            });

            window.addEventListener('focus', onFocusBack);
            input.click();
        },

        _upload(file, ta, refresh) {
            const fd = new FormData();
            fd.append('file', file);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', getUploadUrl());
            xhr.onload = function () {
                let res = null;
                try { res = JSON.parse(xhr.responseText); } catch (e) {}
                if (!res || !res.ok || !res.file) {
                    const err = (res && res.error) || '上传失败';
                    if (window.showAlert) window.showAlert(err, { title: '上传图片' });
                    else alert(err);
                    return;
                }
                const url = getViewUrl(res.file.id);
                const name = String(res.file.filename || '图片').replace(/[\[\]]/g, '_');
                const md = '![' + name + '](' + url + ')';
                if (window.EditorUtils && window.EditorUtils.insertAt) {
                    window.EditorUtils.insertAt(ta, md);
                }
                if (refresh) refresh();
            };
            xhr.onerror = function () {
                if (window.showAlert) window.showAlert('网络错误', { title: '上传图片' });
            };
            xhr.send(fd);
        },
    };
})();

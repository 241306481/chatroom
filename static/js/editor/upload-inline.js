(function () {
    function getUploadUrl(visibility) {
        const dn = window.__DOMAIN__;
        if (dn) return '/domain/' + encodeURIComponent(dn) + '/files/upload';
        return '/myfile/upload'
            + (visibility === 'public' ? '?visibility=public' : '');
    }

    function getViewUrl(fileId) {
        const dn = window.__DOMAIN__;
        const uid = window.MY_UID || window.__CURRENT_UID__ || '';
        if (dn) return location.origin + '/domain/' + encodeURIComponent(dn) + '/files/' + fileId;
        return location.origin + '/myfile/' + encodeURIComponent(uid) + '/' + fileId;
    }

    window.EditorUpload = {
        pickAndUpload(ta, refresh, opts) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.display = 'none';
            document.body.appendChild(input);

            let settled = false;
            const cleanup = function () {
                if (settled) return;
                settled = true;
                input.remove();
                window.removeEventListener('focus', onFocusBack);
            };
            const onFocusBack = function () {
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
                window.EditorUpload._upload(f, ta, refresh, opts);
            });

            window.addEventListener('focus', onFocusBack);
            input.click();
        },

        _upload(file, ta, refresh, opts) {
            const fd = new FormData();
            fd.append('file', file);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', getUploadUrl(opts && opts.visibility));
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

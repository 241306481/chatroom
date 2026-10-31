(function () {
    function getUploadUrl(visibility) {
        const dn = window.__DOMAIN__;
        const disc = window.__DISCUSS__;
        const peer = document.body.dataset.dmTarget || '';
        if (disc) {
            return '/domain/' + encodeURIComponent(dn) + '/discuss/'
                + encodeURIComponent(disc) + '/files/upload';
        }
        if (peer) {
            return '/messages/' + encodeURIComponent(peer) + '/files/upload';
        }
        if (dn) return '/domain/' + encodeURIComponent(dn) + '/files/upload';
        return '/myfile/upload'
            + (visibility === 'public' ? '?visibility=public' : '');
    }
    function getViewUrl(fileId) {
        const dn = window.__DOMAIN__;
        const disc = window.__DISCUSS__;
        const peer = document.body.dataset.dmTarget || '';
        const uid = window.MY_UID || window.__CURRENT_UID__ || '';
        const origin = location.origin;
        if (disc) {
            return origin + '/domain/' + encodeURIComponent(dn)
                + '/discuss/' + encodeURIComponent(disc)
                + '/file/' + encodeURIComponent(fileId);
        }
        if (peer) {
            const lower = String(Math.min(Number(uid), Number(peer)) || uid);
            const higher = String(Math.max(Number(uid), Number(peer)) || peer);
            return origin + '/messages/file/'
                + encodeURIComponent(lower) + '/'
                + encodeURIComponent(higher) + '/'
                + encodeURIComponent(fileId);
        }
        if (dn) return origin + '/domain/' + encodeURIComponent(dn) + '/files/' + fileId;
        return origin + '/myfile/' + encodeURIComponent(uid) + '/' + fileId;
    }
    window.EditorUpload = {
        pickAndUpload(ta, refresh, opts) {
            const kind = (opts && opts.kind) || 'image';
            const input = document.createElement('input');
            input.type = 'file';
            if (kind === 'image') {
                input.accept = 'image/*';
            } else if (kind === 'file') {
                input.removeAttribute('accept');
            }
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
            const kind = (opts && opts.kind) || 'image';
            const fd = new FormData();
            fd.append('file', file);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', getUploadUrl(opts && opts.visibility));
            xhr.onload = function () {
                let res = null;
                try { res = JSON.parse(xhr.responseText); } catch (e) {}
                if (!res || !res.ok || !res.file) {
                    const err = (res && res.error) || '上传失败';
                    const title = kind === 'image' ? '上传图片' : '上传附件';
                    if (window.showAlert) window.showAlert(err, { title });
                    else alert(err);
                    return;
                }
                const url = getViewUrl(res.file.id);
                const name = String(res.file.filename || (kind === 'image' ? '图片' : '附件'))
                    .replace(/[\[\]]/g, '_');
                const md = '![' + name + '](' + url + ')';
                if (window.EditorUtils && window.EditorUtils.insertAt) {
                    window.EditorUtils.insertAt(ta, md);
                }
                if (refresh) refresh();
            };
            xhr.onerror = function () {
                const title = kind === 'image' ? '上传图片' : '上传附件';
                if (window.showAlert) window.showAlert('网络错误', { title });
            };
            xhr.send(fd);
        },
    };
})();

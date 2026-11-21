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
    function getThumbUrl(url) {
        return url + (url.indexOf('?') < 0 ? '?' : '&') + 'thumb=1';
    }
    function isImageFile(file) {
        return !!file && (/^image\//i.test(file.type || '')
            || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name || ''));
    }
    function fileExt(name) {
        const m = /\.([a-z0-9]{1,10})$/i.exec(String(name || '').split(/[?#]/)[0]);
        return m ? m[1].toLowerCase() : '';
    }
    function fileKind(file, opts) {
        if (opts && opts.kind) return opts.kind;
        return isImageFile(file) ? 'image' : 'file';
    }
    const pendingPaste = new WeakMap();
    function pendingFor(ta) {
        let list = pendingPaste.get(ta);
        if (!list) {
            list = [];
            pendingPaste.set(ta, list);
        }
        return list;
    }
    function createProgress(file, title) {
        const box = document.createElement('div');
        box.className = 'inline-upload-progress';
        const nameEl = document.createElement('span');
        nameEl.className = 'inline-upload-progress-name';
        nameEl.textContent = '上传中：' + (file.name || title) + ' 0%';
        const bar = document.createElement('div');
        bar.className = 'inline-upload-progress-bar';
        const fill = document.createElement('i');
        bar.appendChild(fill);
        box.appendChild(nameEl);
        box.appendChild(bar);
        document.body.appendChild(box);
        return {
            update(pct) {
                nameEl.textContent = '上传中：' + (file.name || title) + ' ' + pct + '%';
                fill.style.width = pct + '%';
            },
            cleanup() {
                if (box.parentNode) box.parentNode.removeChild(box);
            },
        };
    }
    function uploadMarkdown(file, opts) {
        const kind = fileKind(file, opts);
        const title = kind === 'image' ? '上传图片' : '上传附件';
        const fd = new FormData();
        fd.append('file', file);
        const xhr = new XMLHttpRequest();
        const progress = createProgress(file, title);
        return new Promise(resolve => {
            xhr.open('POST', getUploadUrl(opts && opts.visibility));
            xhr.upload.onprogress = function (e) {
                if (!e.lengthComputable) return;
                progress.update(Math.min(100, Math.round(e.loaded / e.total * 100)));
            };
            xhr.onload = function () {
                progress.cleanup();
                let res = null;
                try { res = JSON.parse(xhr.responseText); } catch (e) {}
                if (!res || !res.ok || !res.file) {
                    const err = (res && res.error) || '上传失败';
                    if (window.showAlert) window.showAlert(err, { title });
                    else alert(err);
                    resolve(null);
                    return;
                }
                const url = getViewUrl(res.file.id);
                const name = String(res.file.filename || (kind === 'image' ? '图片' : '附件'))
                    .replace(/[\[\]]/g, '_');
                if (kind === 'image') {
                    resolve('[![' + name + '](' + getThumbUrl(url) + ')](' + url + ')');
                    return;
                }
                const ext = (fileExt(res.file.filename || file.name) || 'file')
                    .replace(/[^a-z0-9]/gi, '') || 'file';
                const isPdf = /^application\/pdf$/i.test(file.type || '')
                    || /\.pdf$/i.test(file.name || '');
                resolve('::file[' + ext + '](' + url + ')' + (isPdf ? '{open}' : ''));
            };
            xhr.onerror = function () {
                progress.cleanup();
                if (window.showAlert) window.showAlert('网络错误', { title });
                resolve(null);
            };
            xhr.onabort = progress.cleanup;
            xhr.send(fd);
        });
    }
    function insertMarkdown(ta, markdown, refresh) {
        if (!markdown) return false;
        if (window.EditorUtils && window.EditorUtils.insertAt) {
            window.EditorUtils.insertAt(ta, markdown);
        }
        if (refresh) refresh();
        return true;
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
        pasteFiles(files, ta, refresh, opts) {
            const list = Array.from(files || []).filter(Boolean);
            if (!list.length) return Promise.resolve(0);
            const pending = pendingFor(ta);
            list.forEach(file => pending.push({ file, opts: opts || {} }));
            if (window.showToast) {
                window.showToast('已添加 ' + list.length + ' 个文件，将在发送时上传');
            }
            return Promise.resolve(list.length);
        },
        hasPending(ta) {
            const list = pendingPaste.get(ta);
            return !!(list && list.length);
        },
        flushPending(ta, refresh) {
            const list = pendingPaste.get(ta);
            if (!list || !list.length) return Promise.resolve('');
            pendingPaste.delete(ta);
            const failed = [];
            const markdown = [];
            return list.reduce((chain, item) =>
                chain.then(() => uploadMarkdown(item.file, item.opts).then(md => {
                    if (md === null) failed.push(item);
                    else markdown.push(md);
                })), Promise.resolve()).then(() => {
                if (failed.length) {
                    pendingPaste.set(ta, failed);
                    return null;
                }
                if (refresh) refresh();
                return markdown.join('\n\n');
            });
        },
        dropFiles(files, ta, refresh, opts) {
            const list = Array.from(files || []).filter(Boolean);
            if (!list.length) return Promise.resolve(0);
            return list.reduce((chain, file) => chain.then(() => {
                return this._upload(file, ta, refresh, Object.assign({}, opts, {
                    kind: isImageFile(file) ? 'image' : 'file',
                }));
            }), Promise.resolve()).then(() => list.length);
        },
        _upload(file, ta, refresh, opts) {
            return uploadMarkdown(file, opts).then(md => insertMarkdown(ta, md, refresh));
        },
    };
})();

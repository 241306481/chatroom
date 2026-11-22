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
    function formatSize(size) {
        const n = Number(size) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) {
            return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
        }
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }
    const pendingPaste = new WeakMap();
    const liveEntries = new Set();
    let pendingSeq = 0;
    function pendingFor(ta) {
        let list = pendingPaste.get(ta);
        if (!list) {
            list = [];
            pendingPaste.set(ta, list);
        }
        return list;
    }
    function revokeEntry(entry) {
        if (!entry) return;
        if (entry.url) {
            try { URL.revokeObjectURL(entry.url); } catch (e) {}
            entry.url = '';
        }
        liveEntries.delete(entry);
    }
    function statusLabel(status) {
        if (status === 'uploading') return '上传中';
        if (status === 'uploaded') return '已上传，待发送';
        if (status === 'failed') return '上传失败，可重试';
        return '待发送';
    }
    function buildPendingCard(entry) {
        const card = document.createElement('div');
        card.className = 'md-pending-item';
        card.dataset.pendingId = entry.id;
        card.dataset.status = entry.status || 'pending';
        const name = entry.file.name || '未命名文件';
        if (entry.kind === 'image' && entry.url) {
            const img = document.createElement('img');
            img.className = 'md-pending-thumb';
            img.src = entry.url;
            img.alt = name;
            img.loading = 'lazy';
            card.appendChild(img);
        } else {
            const icon = document.createElement('span');
            icon.className = 'md-pending-icon';
            icon.textContent = (fileExt(name) || '文件').slice(0, 4).toUpperCase();
            card.appendChild(icon);
        }
        const info = document.createElement('span');
        info.className = 'md-pending-info';
        const nameEl = document.createElement('span');
        nameEl.className = 'md-pending-name';
        nameEl.textContent = name;
        nameEl.title = name;
        const meta = document.createElement('span');
        meta.className = 'md-pending-meta';
        meta.textContent = formatSize(entry.file.size) + ' · '
            + statusLabel(entry.status);
        info.appendChild(nameEl);
        info.appendChild(meta);
        card.appendChild(info);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-pending-remove';
        btn.dataset.pendingRemove = '';
        btn.title = '移除附件（发送时不再上传）';
        btn.setAttribute('aria-label', '移除附件');
        btn.textContent = '×';
        btn.disabled = entry.status === 'uploading';
        card.appendChild(btn);
        return card;
    }
    function ensureTray(root, selector, className, beforeSelector) {
        let tray = root.querySelector(selector);
        if (tray) return tray;
        const anchor = root.querySelector(beforeSelector);
        if (!anchor || !anchor.parentNode) return null;
        tray = document.createElement('div');
        tray.className = className;
        tray.setAttribute(selector.replace(/^\[|\]$/g, ''), '');
        tray.hidden = true;
        anchor.parentNode.insertBefore(tray, anchor);
        return tray;
    }
    function bindPendingUI(root, ta) {
        if (root.dataset.pendingUiBound === '1') return;
        root.dataset.pendingUiBound = '1';
        root.addEventListener('click', function (e) {
            const btn = e.target && e.target.closest
                ? e.target.closest('.md-pending-remove') : null;
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const card = btn.closest('[data-pending-id]');
            if (card) removePending(ta, card.dataset.pendingId);
        });
    }
    function syncPendingUI(ta) {
        if (!ta) return;
        const root = ta.closest ? ta.closest('.md-editor') : null;
        if (!root) return;
        bindPendingUI(root, ta);
        const list = pendingPaste.get(ta) || [];
        root.classList.toggle('md-editor-has-pending', list.length > 0);
        const trays = [
            ensureTray(root, '[data-pending-files]', 'md-pending-files',
                '.md-editor-content'),
            ensureTray(root, '[data-pending-preview]', 'md-pending-preview',
                '.md-editor-preview'),
        ];
        trays.forEach(function (tray) {
            if (!tray) return;
            if (!list.length) {
                tray.hidden = true;
                tray.dataset.count = '0';
                tray.replaceChildren();
                return;
            }
            const frag = document.createDocumentFragment();
            list.forEach(function (entry) {
                frag.appendChild(buildPendingCard(entry));
            });
            tray.replaceChildren(frag);
            tray.dataset.count = String(list.length);
            tray.hidden = false;
        });
    }
    function removePending(ta, id) {
        const list = pendingPaste.get(ta);
        if (!list) return;
        const idx = list.findIndex(function (item) { return item.id === id; });
        if (idx < 0) return;
        const entry = list.splice(idx, 1)[0];
        revokeEntry(entry);
        if (!list.length) pendingPaste.delete(ta);
        syncPendingUI(ta);
    }
    function queueFiles(files, ta, opts) {
        const list = Array.from(files || []).filter(Boolean);
        if (!list.length || !ta) return 0;
        const pending = pendingFor(ta);
        list.forEach(function (file) {
            const kind = fileKind(file, opts);
            const entry = {
                id: 'p' + (++pendingSeq) + '_' + Date.now(),
                file: file,
                opts: opts || {},
                kind: kind,
                status: 'pending',
                url: '',
                md: '',
            };
            if (kind === 'image') {
                try { entry.url = URL.createObjectURL(file); } catch (e) {}
            }
            pending.push(entry);
            liveEntries.add(entry);
        });
        syncPendingUI(ta);
        if (window.showToast) {
            window.showToast('已添加 ' + list.length + ' 个文件，将在发送时上传');
        }
        return list.length;
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
    function revokeAll() {
        liveEntries.forEach(function (entry) {
            if (!entry.url) return;
            try { URL.revokeObjectURL(entry.url); } catch (e) {}
            entry.url = '';
        });
    }
    window.addEventListener('beforeunload', revokeAll);
    window.addEventListener('pagehide', revokeAll);
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
                queueFiles([f], ta, opts);
            });
            window.addEventListener('focus', onFocusBack);
            input.click();
        },
        pasteFiles(files, ta, refresh, opts) {
            return Promise.resolve(queueFiles(files, ta, opts));
        },
        hasPending(ta) {
            const list = pendingPaste.get(ta);
            return !!(list && list.length);
        },
        flushPending(ta, refresh) {
            const list = pendingPaste.get(ta);
            if (!list || !list.length) return Promise.resolve('');
            const batch = list.slice();
            const failed = [];
            return batch.reduce(function (chain, item) {
                return chain.then(function () {
                    if (item.md) return;
                    const current = pendingPaste.get(ta);
                    if (!current || current.indexOf(item) < 0) return;
                    item.status = 'uploading';
                    syncPendingUI(ta);
                    return uploadMarkdown(item.file, item.opts).then(function (md) {
                        const live = pendingPaste.get(ta);
                        if (!live || live.indexOf(item) < 0) return;
                        if (md === null) {
                            item.status = 'failed';
                            failed.push(item);
                        } else {
                            item.md = md;
                            item.status = 'uploaded';
                        }
                        syncPendingUI(ta);
                    });
                });
            }, Promise.resolve()).then(function () {
                if (failed.length) return null;
                const current = pendingPaste.get(ta);
                const markdown = [];
                batch.forEach(function (item) {
                    if (!current || current.indexOf(item) < 0) return;
                    if (item.md) markdown.push(item.md);
                    const idx = current.indexOf(item);
                    if (idx >= 0) current.splice(idx, 1);
                    revokeEntry(item);
                });
                if (!current || !current.length) pendingPaste.delete(ta);
                syncPendingUI(ta);
                if (refresh) refresh();
                return markdown.join('\n\n');
            });
        },
        dropFiles(files, ta, refresh, opts) {
            return Promise.resolve(queueFiles(files, ta, opts));
        },
        _upload(file, ta, refresh, opts) {
            return uploadMarkdown(file, opts).then(md => insertMarkdown(ta, md, refresh));
        },
    };
})();

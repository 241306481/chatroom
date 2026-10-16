// 头像上传 / 删除。挂在 profile 页的编辑区。
(function () {
    const fileInput = document.getElementById('avatarFile');
    const uploadBtn = document.getElementById('avatarUploadBtn');
    const clearBtn = document.getElementById('avatarClearBtn');
    if (!fileInput || !uploadBtn) return;

    // 上传中要禁掉按钮，避免重复提交产生并发写
    let busy = false;

    function setBusy(on) {
        busy = on;
        uploadBtn.disabled = on;
        if (clearBtn) clearBtn.disabled = on;
        uploadBtn.textContent = on ? '上传中…' : '上传头像';
    }

    function afterChange() {
        // 换图后 URL 变了，重新加载才能拿到新图
        location.reload();
    }

    uploadBtn.addEventListener('click', function () { fileInput.click(); });

    fileInput.addEventListener('change', function () {
        const f = fileInput.files && fileInput.files[0];
        if (!f || busy) return;

        // 前端先挡一道，减少无谓往返；服务端仍按魔数复验
        if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
            alert('仅支持 PNG / JPEG / GIF / WebP');
            fileInput.value = '';
            return;
        }
        if (f.size > 2 * 1024 * 1024) {
            alert('头像不能超过 2 MB');
            fileInput.value = '';
            return;
        }

        setBusy(true);
        const fd = new FormData();
        fd.append('file', f);
        fetch('/settings/avatar', { method: 'POST', body: fd, credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || !j.ok) {
                    alert((j && j.error) || '上传失败');
                    setBusy(false);
                    fileInput.value = '';
                    return;
                }
                afterChange();
            })
            .catch(function () {
                alert('上传失败');
                setBusy(false);
                fileInput.value = '';
            });
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            if (busy) return;
            if (!window.showConfirm('删除头像？')) return;
            setBusy(true);
            fetch('/settings/avatar/clear', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (!j || !j.ok) {
                        alert((j && j.error) || '删除失败');
                        setBusy(false);
                        return;
                    }
                    afterChange();
                })
                .catch(function () { alert('删除失败'); setBusy(false); });
        });
    }
})();
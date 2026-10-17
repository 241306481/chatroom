'use strict';
// 选中后随「保存」提交，不立刻上传
(function () {
    const box = document.getElementById('avatarEditBox');
    const file = document.getElementById('avatarFile');
    const pickBtn = document.getElementById('avatarPickBtn');
    const removeBtn = document.getElementById('avatarRemoveBtn');
    const cancelBtn = document.getElementById('avatarCancelBtn');
    const picked = document.getElementById('avatarPicked');
    const removeField = document.getElementById('avatarRemove');
    if (!box || !file || !pickBtn) return;

    const MAX = 1024 * 1024;
    const hadAvatar = box.dataset.hasAvatar === '1';

    function refresh() {
        const hasNew = !!(file.files && file.files.length);
        const willRemove = removeField.value === '1';
        picked.hidden = !hasNew;
        removeBtn.hidden = !(hadAvatar && !hasNew && !willRemove);
        cancelBtn.hidden = !(hasNew || willRemove);
    }

    function reset() {
        file.value = '';
        removeField.value = '0';
        refresh();
    }

    pickBtn.addEventListener('click', function () { file.click(); });

    file.addEventListener('change', function () {
        const f = file.files && file.files[0];
        if (!f) return;
        if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
            window.showAlert ? window.showAlert('仅支持 PNG / JPEG / GIF / WebP')
                : alert('仅支持 PNG / JPEG / GIF / WebP');
            file.value = '';
            return;
        }
        if (f.size > MAX) {
            window.showAlert ? window.showAlert('头像不能超过 1 MB')
                : alert('头像不能超过 1 MB');
            file.value = '';
            return;
        }
        removeField.value = '0';
        picked.textContent = '已选择：' + f.name;
        refresh();
    });

    if (removeBtn) {
        removeBtn.addEventListener('click', function () {
            removeField.value = '1';
            file.value = '';
            refresh();
        });
    }
    if (cancelBtn) cancelBtn.addEventListener('click', reset);

    // 取消编辑时一并复位
    const cancelEdit = document.getElementById('profileCancelBtn');
    if (cancelEdit) cancelEdit.addEventListener('click', reset);

    refresh();
})();
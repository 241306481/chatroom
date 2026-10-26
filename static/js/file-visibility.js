'use strict';
window.toggleFileVisibility = function (btn, actionUrl) {
    const cur = btn.dataset.visibility || 'private';
    const next = cur === 'public' ? 'private' : 'public';
    const body = 'visibility=' + next;
    fetch(actionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    }).then(r => r.json()).then(res => {
        if (!res.ok) {
            if (window.showAlert) window.showAlert(res.error || '操作失败');
            return;
        }
        btn.dataset.visibility = res.visibility;
        btn.textContent = res.visibility === 'public' ? '🔓 公开' : '🔒 隐藏';
    }).catch(() => {
        if (window.showAlert) window.showAlert('网络错误');
    });
};

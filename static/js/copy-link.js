// ============================================================
// 复制文件查看链接（纯 URL，不带 /download）
// ============================================================
(function () {
    function fallbackCopy(text) {
        const t = document.createElement('textarea');
        t.value = text;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        try { document.execCommand('copy'); } catch (e) {}
        t.remove();
    }

    window.copyFileLink = function (btn) {
        const rel = btn.dataset.copyUrl || btn.dataset.downloadUrl || '';
        if (!rel) return;
        const abs = location.origin + rel;

        const done = () => {
            const old = btn.textContent;
            btn.textContent = '✅ 已复制';
            setTimeout(() => { btn.textContent = old; }, 1500);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(abs).then(done).catch(() => {
                fallbackCopy(abs);
                done();
            });
        } else {
            fallbackCopy(abs);
            done();
        }
    };
})();

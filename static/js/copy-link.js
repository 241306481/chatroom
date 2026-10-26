(function () {
    window.copyFileLink = function (btn) {
        const rel = btn.dataset.copyUrl || btn.dataset.downloadUrl || '';
        if (!rel) return;
        const abs = location.origin + rel;
        navigator.clipboard.writeText(abs).then(function () {
            const old = btn.textContent;
            btn.textContent = '✓ 已复制';
            setTimeout(function () { btn.textContent = old; }, 1500);
        });
    };
})();

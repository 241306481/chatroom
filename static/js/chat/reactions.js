// ============================================================
// 表情反应：发送 + 选择器
// ============================================================
(function () {

    const REACTION_EMOJIS = ['👍', '👎', '❤️', '🎉', '😂', '😮', '😢', '🔥', '👀', '✅'];

    // ---------- 发送 ----------
    window.sendReaction = function (id, emoji) {
        if (window.ChatWS && window.ChatWS.send) {
            window.ChatWS.send({ type: 'reaction', message_id: id, emoji });
        }
    };

    // ---------- 弹出选择器 ----------
    // 关闭必须同时摘掉 picker 和 document 上的捕获阶段监听器。
    // 此前 close 只在它自己体内注销，而 picker 有三条移除路径
    // （点 emoji、第 20 行换一条消息时的清扫、第 18 行的再次点击），
    // 都会留下一个持有已分离 DOM 子树的 document 监听器，
    // 之后每次点击都会触发它，直到某次「点击外部」恰好把它注销。
    window.toggleReactionPicker = function (msgId, btn) {
        const existId = 'reaction-picker-' + msgId;
        const existing = document.getElementById(existId);
        if (existing) { existing.remove(); return; }

        const picker = document.createElement('div');
        picker.id = existId;
        picker.className = 'reaction-picker';

        let close = null;
        const teardown = function () {
            if (close) { document.removeEventListener('click', close, true); close = null; }
            if (picker.parentNode) picker.remove();
        };
        // 每次只保留一个选择器；先清扫其余的（连同它们各自的监听器）
        const openPickers = document.querySelectorAll('.reaction-picker');
        for (const el of openPickers) {
            if (el !== picker && el.__teardown) el.__teardown();
            el.remove();
        }

        REACTION_EMOJIS.forEach(function (e) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = e;
            b.addEventListener('click', function () {
                window.sendReaction(msgId, e);
                teardown();
            });
            picker.appendChild(b);
        });
        document.body.appendChild(picker);

        // 定位：优先显示在按钮下方，空间不足时显示在上方
        const r = btn.getBoundingClientRect();
        const pw = picker.offsetWidth;
        const ph = picker.offsetHeight;

        let left = r.left + window.scrollX + r.width - pw / 2;
        const minLeft = window.scrollX + 8;
        const maxLeft = window.scrollX + document.documentElement.clientWidth - pw - 8;
        if (left < minLeft) left = minLeft;
        if (left > maxLeft) left = maxLeft;

        const spaceBelow = window.innerHeight - r.bottom;
        const top = spaceBelow >= ph + 12
            ? r.bottom + window.scrollY + 4
            : r.top + window.scrollY - ph - 4;

        picker.style.left = left + 'px';
        picker.style.top = top + 'px';

        // 点击外部关闭
        picker.__teardown = teardown;
        setTimeout(function () {
            close = function (ev) {
                if (!picker.contains(ev.target) && ev.target !== btn) {
                    teardown();
                }
            };
            document.addEventListener('click', close, true);
        }, 0);
    };
})();
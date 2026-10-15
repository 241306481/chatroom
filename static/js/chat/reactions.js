// 表情反应
(function () {

    const REACTION_EMOJIS = ['👍', '👎', '❤️', '🎉', '😂', '😮', '😢', '🔥', '👀', '✅'];

// 发送
    window.sendReaction = function (id, emoji) {
        if (window.ChatWS && window.ChatWS.send) {
            window.ChatWS.send({ type: 'reaction', message_id: id, emoji });
        }
    };

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
        // 只留一个选择器
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

        // 下优先，不足则上
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
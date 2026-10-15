// 回复状态 + 滚动定位
(function () {

    window.ChatReply = {
        state: { id: null },
    };

// 设置回复目标
    window.setReplyTo = function (msgId) {
        window.ChatReply.state.id = msgId;

        const inputArea = document.querySelector('.message-input-area');
        if (!inputArea) return;

        const el = document.querySelector('.message[data-id="' + msgId + '"]');
        const nick = el ? (el.querySelector('.msg-nick') || {}).textContent || '?' : '?';
        let content = '';
        if (el) {
            const contentEl = el.querySelector('.msg-content');
            if (contentEl) content = contentEl.dataset.raw || contentEl.textContent || '';
        }

        let banner = document.getElementById('replyBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'replyBanner';
            banner.className = 'reply-banner';
            inputArea.insertBefore(banner, inputArea.firstChild);
        }
        const preview = Array.from(content).slice(0, 60).join('');
        banner.innerHTML =
            '<span>回复 <b>' + esc(nick) + '</b>：' + esc(preview) + '</span>' +
            '<button type="button" title="取消回复" onclick="clearReplyTo()">×</button>';

        const ta = document.getElementById('msgInput');
        if (ta) ta.focus();
    };

// 取消回复
    window.clearReplyTo = function () {
        window.ChatReply.state.id = null;
        const b = document.getElementById('replyBanner');
        if (b) b.remove();
    };

// 滚动到某条消息
    window.scrollToMessage = function (id) {
        const el = document.querySelector('.message[data-id="' + id + '"]');
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(() => el.classList.remove('highlight'), 1500);
    };
})();
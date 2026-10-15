// 消息操作：发送 / 删除 / 置顶 / 禁言
(function () {

// 发送
    window.sendMessage = function () {
        const input = document.getElementById('msgInput');
        if (!input) return;
        const content = input.value.trim();
        if (!content) return;
        if (!window.ChatWS || !window.ChatWS.isOpen()) {
            window.ChatRender.showToast('未就绪');
            return;
        }
        const payload = { type: 'message', content };
        const replyTo = window.ChatReply && window.ChatReply.state.id;
        if (replyTo) payload.reply_to = replyTo;
        window.ChatWS.send(payload);

        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        window.clearReplyTo();
    };

// 删除
    window.deleteMessage = function (id) {
        window.showConfirm('删除这条消息？').then(function (ok) {
            if (!ok) return;
            if (window.ChatWS && window.ChatWS.isOpen()) {
                window.ChatWS.send({ type: 'delete', message_id: id });
            }
        });
    };

// 置顶 / 取消置顶
    window.pinMessage = function (id) {
        if (window.ChatWS && window.ChatWS.isOpen()) {
            window.ChatWS.send({ type: 'pin', message_id: id });
        }
    };
    window.unpinMessage = window.pinMessage;

// 禁言成员
    window.muteMember = function (uid) {
        window.showPrompt('禁言时长（分钟）', '60', { title: '禁言成员' }).then(function (mins) {
            if (mins === null) return;
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = location.pathname.replace(/\/discuss\/.*$/, '/manage/user');
            form.innerHTML = `<input name="action" value="mute">
                <input name="user_id" value="${uid}">
                <input name="minutes" value="${parseInt(mins, 10) || 60}">`;
            document.body.appendChild(form);
            form.submit();
        });
    };
})();
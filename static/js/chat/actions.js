(function () {
    const pendingSends = [];
    window.ChatSendQueue = {
        ack: function (msg) {
            if (!msg) return;
            const idx = pendingSends.findIndex(p => p.content === msg.content);
            if (idx >= 0) pendingSends.splice(idx, 1);
        },
        restore: function () {
            const now = Date.now();
            for (let i = pendingSends.length - 1; i >= 0; i--) {
                const p = pendingSends[i];
                if (now - p.at > 30000) {
                    pendingSends.splice(i, 1);
                    continue;
                }
                pendingSends.splice(i, 1);
                const input = document.getElementById('msgInput');
                if (!input || input.value.trim()) return;
                input.value = p.content;
                if (p.replyTo && window.ChatReply && !window.ChatReply.state.id) {
                    window.setReplyTo(p.replyTo);
                }
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
        },
    };
    window.sendMessage = function () {
        const input = document.getElementById('msgInput');
        if (!input || input.dataset.sending === '1') return;
        if (!window.ChatWS || !window.ChatWS.isOpen()) {
            window.ChatRender.showToast('未就绪');
            return;
        }
        const hasPending = window.EditorUpload && window.EditorUpload.hasPending
            && window.EditorUpload.hasPending(input);
        if (!input.value.trim() && !hasPending) return;
        input.dataset.sending = '1';
        const ready = hasPending
            ? window.EditorUpload.flushPending(input, null)
            : Promise.resolve('');
        ready.then(function (extra) {
            delete input.dataset.sending;
            if (extra === null) return;
            let content = input.value.trim();
            if (extra) content = content ? content + '\n\n' + extra : extra;
            if (!content) return;
            const lengthError = window.checkMessageLength
                && window.checkMessageLength(content);
            if (lengthError) {
                if (window.ChatRender && window.ChatRender.showToast) {
                    window.ChatRender.showToast(lengthError);
                }
                return;
            }
            const payload = { type: 'message', content };
            const replyTo = window.ChatReply && window.ChatReply.state.id;
            if (replyTo) payload.reply_to = replyTo;
            pendingSends.push({ content, replyTo: replyTo || '', at: Date.now() });
            if (pendingSends.length > 20) pendingSends.shift();
            window.ChatWS.send(payload);
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            window.clearReplyTo();
        }).catch(function () {
            delete input.dataset.sending;
            if (window.ChatRender && window.ChatRender.showToast) {
                window.ChatRender.showToast('发送失败');
            }
        });
    };
    window.deleteMessage = function (id) {
        window.showConfirm('删除这条消息？').then(function (ok) {
            if (!ok) return;
            if (window.ChatWS && window.ChatWS.isOpen()) {
                window.ChatWS.send({ type: 'delete', message_id: id });
            }
        });
    };
    window.pinMessage = function (id) {
        if (window.ChatWS && window.ChatWS.isOpen()) {
            window.ChatWS.send({ type: 'pin', message_id: id });
        }
    };
    window.unpinMessage = window.pinMessage;
    function memberAction(uid, fields, successMessage) {
        const body = new URLSearchParams(Object.assign({
            user_id: uid,
            no_flash: '1',
        }, fields));
        const dn = window.__DOMAIN__ || '';
        const manageUrl = dn
            ? '/domain/' + encodeURIComponent(dn) + '/manage/user'
            : '/manage/user';
        fetch(manageUrl, {
            method: 'POST',
            body: body,
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        }).then(function (res) {
            return res.json().then(function (data) {
                if (!res.ok || !data.ok) throw new Error(data.error || '操作失败');
                if (window.ChatRender && window.ChatRender.showToast) {
                    window.ChatRender.showToast(successMessage);
                }
            });
        }).catch(function (err) {
            const message = err && err.message ? err.message : '网络错误，请稍后重试';
            if (window.showAlert) window.showAlert(message);
        });
    }
    window.muteMember = function (uid) {
        window.showDurationPicker({ kind: 'mute', message: '请选择禁言时长' })
            .then(function (result) {
                if (!result) return;
                const minutes = Math.max(1, Math.min(43200, parseInt(result.minutes, 10) || 60));
                memberAction(uid, {
                    action: 'mute',
                    minutes: String(minutes),
                }, '已禁言 ' + minutes + ' 分钟');
            });
    };
    window.unmuteMember = function (uid) {
        window.showConfirm('确定解除该成员的禁言？').then(function (ok) {
            if (!ok) return;
            memberAction(uid, { action: 'unmute' }, '已解除禁言');
        });
    };
})();

(function () {
    const R = window.ChatRender = window.ChatRender || {};
    function buildMessageEl(msg) {
        const escSingle = function (s) {
            return String(s == null ? '' : s)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/"/g, '&quot;')
                .replace(/</g, '\\x3c')
                .replace(/>/g, '\\x3e')
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r');
        };
        const div = document.createElement('div');
        div.className = 'message';
        if (msg.is_system) div.classList.add('system-msg');
        if (msg.revoked) div.classList.add('revoked-msg');
        div.dataset.id = msg.id;
        if (msg.id) div.id = 'msg-' + msg.id;
        if (msg.reply_to) div.dataset.replyTo = msg.reply_to;
        const canPin = window.__CAN_PIN__ === true;
        const canDeleteAny = window.__CAN_DELETE_ANY__ === true;
        const canAddReaction = window.__CAN_ADD_REACTION__ === true;
        const isOwn = msg.user_id === window.MY_UID;
        const showPin = canPin && !msg.revoked;
        const showDelete = canDeleteAny || isOwn;
        const revoked = !!msg.revoked;
        const nick = window.Avatar.avatarText(msg.nickname);
        const color = window.Avatar.safeColor(msg.avatar_color);
        const mid = escSingle(msg.id);
        const canBatch = window.__CAN_BATCH__ === true;
        const batchCheck = canBatch
            ? `<input type="checkbox" class="msg-check" data-msg-check value="${escAttr(msg.id)}" aria-label="选择消息">`
            : '';
        const canReply = !!document.getElementById('msgInput') && !revoked;
        const replyBtn = canReply
            ? `<button type="button" class="msg-reply-btn" onclick="setReplyTo('${mid}', this)" title="回复">↩️</button>`
            : '';
        const replyQuote = msg.reply_info
            ? (msg.reply_info.deleted
                ? `<div class="msg-reply-quote msg-reply-quote-deleted"><span class="reply-quote-content"><em>该消息已被删除</em></span></div>`
                : msg.reply_info.revoked
                    ? `<div class="msg-reply-quote msg-reply-quote-revoked"><span class="reply-quote-content"><em>该消息已被撤回</em></span></div>`
                    : `<div class="msg-reply-quote" onclick="scrollToMessage('${escSingle(msg.reply_info.id)}')">
                           <span class="reply-quote-nick">${esc(msg.reply_info.nickname)}</span>
                           <span class="reply-quote-content">${esc(msg.reply_info.content)}</span>
                       </div>`)
            : '';
        const revokeBtn = !revoked && (isOwn
            ? window.__CAN_REVOKE_OWN__ === true
            : window.__CAN_REVOKE_ANY__ === true)
            ? `<button type="button" onclick="revokeMessage('${mid}')" title="撤回">↩️</button>`
            : '';
        const sourceBtn = !revoked
            ? `<button type="button" onclick="toggleSource(this)" title="查看源码">📄</button>`
            : '';
        const reactionBtn = canAddReaction && !revoked
            ? `<button type="button" onclick="toggleReactionPicker('${mid}', this)" title="添加表情">😀</button>`
            : '';
        const reactionsDiv = !revoked
            ? `<div class="msg-reactions" id="reactions-${mid}" data-reactions="${escAttr(msg.reactions_json || '{}')}"></div>`
            : '';
        const contentHtml = revoked
            ? `<div class="msg-content msg-revoked"><a class="revoked-nick" href="/user/${escAttr(msg.revoked_by)}">${esc(msg.revoked_by_nickname)}</a> 撤回了一条消息</div>`
            : `<div class="msg-content md-body" data-raw="${escAttr(msg.content)}">${window.renderContent(msg.content)}</div>`;
        div.innerHTML = `
            ${batchCheck}
            <div class="msg-avatar" style="background:${color}">${esc(nick)}</div>
            <div class="msg-body">
                <div class="msg-header">
                    <span class="msg-nick">${esc(msg.nickname)}</span>
                    ${msg.is_mod ? '<span class="badge mod">MOD</span>' : ''}
                    <span class="msg-time">${esc(msg.created_at)}</span>
                    ${replyBtn}
                    <div class="msg-actions">
                        ${sourceBtn}
                        ${reactionBtn}
                        ${showPin ? `<button type="button" onclick="pinMessage('${mid}')" title="置顶">📌</button>` : ''}
                        ${revokeBtn}
                        ${showDelete ? `<button type="button" onclick="deleteMessage('${mid}')" title="删除">🗑</button>` : ''}
                    </div>
                </div>
                ${replyQuote}
                ${contentHtml}
                ${reactionsDiv}
            </div>`;
        swapAvatar(div, msg, '.msg-avatar');
        return div;
    }
    function buildDMMessageEl(msg) {
        const isMe = !!msg.is_me;
        const div = document.createElement('div');
        div.className = 'dm-msg ' + (isMe ? 'dm-me' : 'dm-other');
        div.dataset.id = msg.id;
        const contentHtml = window.renderContent(msg.content);
        const rawAttr = escAttr(msg.content);
        const nick = msg.nickname || msg.from_nickname || '?';
        const color = window.Avatar.safeColor(msg.avatar_color || msg.from_avatar_color);
        const firstChar = window.Avatar.avatarText(nick);
        div.innerHTML =
            '<div class="dm-avatar-wrap">'
              + '<span class="dm-avatar" style="background:' + esc(color) + '">'
                + esc(firstChar)
              + '</span>'
            + '</div>'
            + '<div class="dm-msg-body">'
              + '<div class="dm-msg-header">'
                + '<span class="dm-nick">' + esc(nick) + '</span>'
                + '<span class="dm-time">' + esc(msg.created_at) + '</span>'
                + '<button type="button" class="msg-mini-btn" '
                + 'onclick="toggleSource(this)" title="查看源码">📄</button>'
              + '</div>'
              + '<div class="dm-bubble md-body" data-raw="' + rawAttr + '">'
                + contentHtml
              + '</div>'
            + '</div>';
        swapAvatar(div, msg, '.dm-avatar');
        return div;
    }
function swapAvatar(div, msg, sel) {
    const ext = msg.avatar_ext || msg.from_avatar_ext || '';
    const uid = msg.user_id || msg.from;
    if (!ext || !uid) return;
    const u = {
        id: uid,
        nickname: msg.nickname || msg.from_nickname,
        avatar_color: msg.avatar_color || msg.from_avatar_color,
        avatar_ext: ext,
    };
    if (!window.Avatar.srcOf(u)) return;
    const span = div.querySelector(sel);
    if (!span || !span.parentNode) return;
    span.replaceWith(window.Avatar.build(u, sel.slice(1)));
}
R.buildMessageEl = buildMessageEl;
    R.buildDMMessageEl = buildDMMessageEl;
})();

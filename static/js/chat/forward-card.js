(function () {
    function normalize(ref) {
        if (!ref || typeof ref !== 'object') return [];
        let list;
        if (Array.isArray(ref.items) && ref.items.length) {
            list = ref.items;
        } else if (ref.id) {
            list = [{
                id: ref.id,
                origin: ref.origin || '',
                content: ref.content || '',
                sender: ref.sender || '',
            }];
        } else {
            return [];
        }
        return list.filter(function (item) {
            return item && typeof item === 'object';
        });
    }
    function isMerged(ref) {
        return normalize(ref).length > 1;
    }
    function splitOrigin(item) {
        const origin = String((item && item.origin) || '').trim();
        let sender = String((item && item.sender) || '').trim();
        if (sender) {
            const suffix = ' · ' + sender;
            if (origin.slice(-suffix.length) === suffix) {
                return { origin: origin.slice(0, -suffix.length).trim(), sender: sender };
            }
            return { origin: origin, sender: sender };
        }
        const at = origin.lastIndexOf(' · ');
        if (at >= 0) {
            return {
                origin: origin.slice(0, at).trim(),
                sender: origin.slice(at + 3).trim(),
            };
        }
        return { origin: origin, sender: '' };
    }
    function splitLegacy(text) {
        const value = String(text == null ? '' : text).replace(/\r\n/g, '\n');
        if (!/^>\s*(?:转发自|转发消息)/.test(value)) {
            return { origin: '', content: value };
        }
        const lines = value.split('\n');
        const origin = lines.shift().replace(/^>\s*/, '').trim();
        while (lines.length && !lines[0].trim()) lines.shift();
        return { origin: origin, content: lines.join('\n') };
    }
    function describe(item) {
        const info = splitOrigin(item);
        const legacy = splitLegacy(item && item.content);
        if (legacy.origin) {
            const extra = splitOrigin({ origin: legacy.origin });
            if (!info.origin) info.origin = extra.origin;
            if (!info.sender) info.sender = extra.sender;
        }
        info.content = legacy.content;
        return info;
    }
    function sourceBlock(item, depth) {
        const level = Number(depth) || 0;
        const nested = level < 4 ? normalize(item.forwarded_from) : [];
        if (nested.length) return formatRef(item.forwarded_from, level + 1);
        const info = describe(item);
        return '> ' + (info.origin || '转发消息')
            + (info.sender ? ' · ' + info.sender : '')
            + '\n\n' + info.content;
    }
    function formatRef(ref, depth) {
        const level = Number(depth) || 0;
        return normalize(ref).map(function (item) {
            return sourceBlock(item, level);
        }).join('\n\n---\n\n');
    }
    function sourceText(item) {
        return sourceBlock(item, 0);
    }
    function plain(text) {
        return String(text == null ? '' : text)
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/[#>*_`~\-\[\]()|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    function excerpt(text, max) {
        const s = plain(text);
        return s.length > max ? s.slice(0, max) + '…' : s;
    }
    function previewText(item, depth) {
        if (!item || depth > 4) return '';
        const nested = normalize(item.forwarded_from);
        if (nested.length) return previewText(nested[0], depth + 1);
        return describe(item).content;
    }
    function build(ref, depth) {
        const level = Number(depth) || 0;
        const items = normalize(ref);
        const first = items[0] || {};
        const merged = items.length > 1;
        const info = describe(first);
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'forward-card' + (level ? ' forward-card-nested' : '');
        card.dataset.action = 'open-forward-card';
        card.dataset.forwardRef = JSON.stringify(ref || {});
        const icon = document.createElement('span');
        icon.className = 'forward-card-icon';
        icon.textContent = '🧾';
        const main = document.createElement('span');
        main.className = 'forward-card-main';
        const title = document.createElement('span');
        title.className = 'forward-card-title';
        title.textContent = merged ? '合并转发' : '转发消息';
        const preview = document.createElement('span');
        preview.className = 'forward-card-preview';
        const labels = [];
        if (info.origin) labels.push(info.origin);
        if (info.sender) labels.push(info.sender);
        const body = excerpt(previewText(first, level + 1), 80);
        preview.textContent = (labels.length ? labels.join(' · ') + '：' : '')
            + (body || '查看聊天记录');
        main.appendChild(title);
        main.appendChild(preview);
        const count = document.createElement('span');
        count.className = 'forward-card-count';
        count.textContent = items.length + ' 条';
        card.appendChild(icon);
        card.appendChild(main);
        card.appendChild(count);
        return card;
    }
    function senderLine(item, info) {
        const line = document.createElement('div');
        line.className = 'forward-record-sender';
        const uid = String((item && item.sender_id) || '').trim();
        const user = {
            id: uid,
            nickname: info.sender,
            avatar_ext: (item && item.sender_avatar_ext) || '',
            avatar_color: (item && item.sender_avatar_color) || '',
        };
        const avatar = window.Avatar ? window.Avatar.build(user, 'forward-record-avatar') : null;
        const name = document.createElement('span');
        name.textContent = info.sender;
        const avatarCol = document.createElement('span');
        avatarCol.className = 'forward-record-avatar-col';
        if (avatar) avatarCol.appendChild(avatar);
        line.appendChild(avatarCol);
        if (uid) {
            const link = document.createElement('a');
            link.href = window.userProfileUrl(uid);
            link.appendChild(name);
            line.appendChild(link);
        } else {
            line.appendChild(name);
        }
        return line;
    }
    function metaRow(item, index) {
        const info = describe(item);
        const meta = document.createElement('div');
        meta.className = 'forward-record-meta';
        if (index != null || info.origin) {
            const originLine = document.createElement('div');
            originLine.className = 'forward-record-origin';
            if (index != null) {
                const order = document.createElement('span');
                order.className = 'forward-record-order';
                order.textContent = String(index + 1);
                originLine.appendChild(order);
            }
            if (info.origin) {
                const origin = document.createElement('span');
                origin.className = 'forward-record-context';
                origin.textContent = info.origin;
                originLine.appendChild(origin);
            }
            meta.appendChild(originLine);
        }
        if (info.sender) meta.appendChild(senderLine(item, info));
        return meta;
    }
    function contentBlock(item) {
        const content = document.createElement('div');
        content.className = 'forward-record-content md-body';
        content.innerHTML = window.renderContent
            ? window.renderContent(item.content || '')
            : window.esc(item.content || '');
        return content;
    }
    function appendBody(host, item, level) {
        const children = level > 4 ? [] : normalize(item.forwarded_from);
        if (children.length > 1) {
            host.appendChild(build(item.forwarded_from, level + 1));
        } else if (children.length === 1) {
            const box = document.createElement('div');
            box.className = 'forward-record-nested';
            box.appendChild(renderItem(children[0], null, level + 1, true));
            host.appendChild(box);
        } else {
            const info = describe(item);
            host.appendChild(contentBlock({ content: info.content }));
        }
    }
    function actionButton(text, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'forward-record-action';
        btn.textContent = text;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        return btn;
    }
    function renderItem(item, index, level, nested) {
        const row = document.createElement('div');
        row.className = 'forward-record-item'
            + (nested ? ' forward-record-item-nested' : '');
        const itemId = String((item && item.id) || '').trim();
        if (itemId) row.dataset.id = itemId;
        if (itemId && window.CollapseUI
            && window.CollapseUI.isMessageCollapsed(itemId)) {
            row.classList.add('forward-record-item-collapsed');
        }
        const meta = metaRow(item, nested ? null : index);
        if (meta.childNodes.length) row.appendChild(meta);
        const body = document.createElement('div');
        body.className = 'forward-record-item-body';
        appendBody(body, item, level);
        const preview = document.createElement('div');
        preview.className = 'forward-record-collapse-preview';
        preview.textContent = '消息已折叠，点击展开';
        preview.setAttribute('role', 'button');
        preview.setAttribute('tabindex', '0');
        const tools = document.createElement('span');
        tools.className = 'forward-record-actions';
        const sourceBtn = actionButton('📄', '查看源码');
        let sourceMode = false;
        sourceBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            sourceMode = !sourceMode;
            body.innerHTML = '';
            if (sourceMode) {
                const source = document.createElement('pre');
                source.className = 'forward-record-source';
                const raw = sourceText(item);
                source.textContent = raw;
                const copyBtn = document.createElement('button');
                copyBtn.type = 'button';
                copyBtn.className = 'source-copy-btn';
                copyBtn.textContent = '复制';
                copyBtn.title = '复制源码';
                copyBtn.addEventListener('click', function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (window.copyToClipboard) window.copyToClipboard(raw, copyBtn);
                });
                source.appendChild(copyBtn);
                body.appendChild(source);
            } else {
                appendBody(body, item, level);
            }
            sourceBtn.textContent = sourceMode ? '👁️' : '📄';
            sourceBtn.title = sourceMode ? '查看渲染' : '查看源码';
            sourceBtn.setAttribute('aria-label', sourceBtn.title);
        });
        const collapseBtn = actionButton('折叠', '折叠消息');
        collapseBtn.classList.add('forward-collapse-avatar-btn');
        function toggleCollapse(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const scroller = row.closest('.forward-record-body');
            const before = row.getBoundingClientRect().top;
            const collapsed = !row.classList.contains('forward-record-item-collapsed');
            row.classList.toggle('forward-record-item-collapsed', collapsed);
            const delta = row.getBoundingClientRect().top - before;
            if (scroller && delta) scroller.scrollTop += delta;
            if (itemId && window.CollapseUI) {
                window.CollapseUI.setMessageCollapsed(itemId, collapsed);
            }
        }
        collapseBtn.addEventListener('click', toggleCollapse);
        preview.addEventListener('click', toggleCollapse);
        tools.appendChild(sourceBtn);
        const sender = meta.querySelector('.forward-record-sender');
        if (sender) {
            sender.appendChild(tools);
            const avatarCol = sender.querySelector('.forward-record-avatar-col');
            if (avatarCol) avatarCol.appendChild(collapseBtn);
            else sender.appendChild(collapseBtn);
        } else {
            if (!meta.parentNode) row.appendChild(meta);
            meta.appendChild(collapseBtn);
            meta.appendChild(tools);
        }
        row.appendChild(body);
        row.appendChild(preview);
        return row;
    }
    function buildSingle(ref) {
        const item = normalize(ref)[0];
        if (!item) return document.createElement('span');
        const box = document.createElement('div');
        box.className = 'forward-single';
        const meta = metaRow(item, null);
        if (meta.childNodes.length) box.appendChild(meta);
        appendBody(box, item, 0);
        return box;
    }
    function enhance(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const found = [];
        if (scope.matches && scope.matches(
            '.msg-content[data-forward-ref], .dm-bubble[data-forward-ref]')) {
            found.push(scope);
        }
        scope.querySelectorAll('.msg-content[data-forward-ref], .dm-bubble[data-forward-ref]')
            .forEach(function (el) { found.push(el); });
        found.forEach(function (el) {
            const first = el.firstElementChild;
            const built = first && (first.classList.contains('forward-card')
                || first.classList.contains('forward-single'));
            if (el.dataset.forwardRendered === '1' && built) return;
            let ref;
            try { ref = JSON.parse(el.dataset.forwardRef || ''); } catch (e) { return; }
            if (!normalize(ref).length) return;
            el.innerHTML = '';
            el.appendChild(isMerged(ref) ? build(ref, 0) : buildSingle(ref));
            el.dataset.forwardRendered = '1';
            el.classList.add('forward-content-host');
        });
    }
    function closeOverlay(overlay) {
        if (overlay && overlay.parentNode) overlay.remove();
    }
    function open(ref) {
        if (!normalize(ref).length) return;
        const stack = [ref];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay forward-record-overlay';
        const box = document.createElement('div');
        box.className = 'modal-box forward-record-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const header = document.createElement('div');
        header.className = 'modal-header forward-record-header';
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'forward-record-back';
        backBtn.textContent = '← 返回';
        const icon = document.createElement('span');
        icon.className = 'modal-icon';
        icon.textContent = '🧾';
        const title = document.createElement('span');
        title.className = 'modal-title';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'forward-record-close';
        closeBtn.textContent = '×';
        closeBtn.title = '关闭';
        closeBtn.setAttribute('aria-label', '关闭');
        header.appendChild(backBtn);
        header.appendChild(icon);
        header.appendChild(title);
        header.appendChild(closeBtn);
        const body = document.createElement('div');
        body.className = 'modal-body forward-record-body';
        function render() {
            const items = normalize(stack[stack.length - 1]);
            title.textContent = items.length > 1
                ? '合并转发（' + items.length + ' 条）' : '转发消息';
            backBtn.hidden = stack.length <= 1;
            body.innerHTML = '';
            items.forEach(function (item, index) {
                body.appendChild(renderItem(item, index, 0, false));
            });
            body.scrollTop = 0;
        }
        function onCollapseSync(ev) {
            const detail = (ev && ev.detail) || {};
            const id = String(detail.id || '').trim();
            if (!id) return;
            const collapsed = !!detail.collapsed;
            body.querySelectorAll('.forward-record-item[data-id]')
                .forEach(function (row) {
                    if (row.dataset.id !== id) return;
                    row.classList.toggle(
                        'forward-record-item-collapsed', collapsed);
                });
        }
        document.addEventListener('chat:message-collapse', onCollapseSync);
        function push(next) {
            if (!normalize(next).length) return;
            stack.push(next);
            render();
            backBtn.focus();
        }
        function pop() {
            if (stack.length <= 1) return;
            stack.pop();
            render();
            if (backBtn.hidden) closeBtn.focus();
            else backBtn.focus();
        }
        overlay._forwardPush = push;
        render();
        box.appendChild(header);
        box.appendChild(body);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('show'); });
        function onKey(e) {
            if (e.key !== 'Escape') return;
            const all = document.querySelectorAll('.forward-record-overlay');
            if (all[all.length - 1] === overlay) close();
        }
        function close() {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('chat:message-collapse', onCollapseSync);
            closeOverlay(overlay);
        }
        backBtn.addEventListener('click', pop);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        document.addEventListener('keydown', onKey);
        closeBtn.focus();
    }
    document.addEventListener('click', function (e) {
        const btn = e.target && e.target.closest
            ? e.target.closest('[data-action="open-forward-card"]') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        let ref;
        try { ref = JSON.parse(btn.dataset.forwardRef || ''); } catch (err) { return; }
        const owner = btn.closest('.forward-record-overlay');
        if (owner && typeof owner._forwardPush === 'function') {
            owner._forwardPush(ref);
            return;
        }
        open(ref);
    });
    window.ChatForwardCard = {
        build: build,
        enhance: enhance,
        isMerged: isMerged,
        normalize: normalize,
        open: open,
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { enhance(document); });
    } else {
        enhance(document);
    }
})();

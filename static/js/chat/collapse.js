(function () {
    const R = window.ChatRender = window.ChatRender || {};

    function previewText() {
        return '消息已折叠，点击展开';
    }

    const STORE_PREFIX = 'chatroom:collapsed:';
    let storeCache = null;
    let storeCacheKey = '';
    function storeKey() {
        const domain = window.__DOMAIN__ || '';
        const uid = window.__CURRENT_UID__ || '';
        const path = (window.location && window.location.pathname) || '';
        return STORE_PREFIX + domain + ':' + uid + ':' + path;
    }
    function readStore() {
        const key = storeKey();
        if (storeCache && storeCacheKey === key) return storeCache;
        let data = null;
        try { data = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
        storeCache = data && typeof data === 'object' ? data : {};
        storeCacheKey = key;
        return storeCache;
    }
    function messageId(root) {
        return String((root && root.dataset && root.dataset.id) || '').trim();
    }
    function isCollapsedId(id) {
        const key = String(id || '').trim();
        return !!key && readStore()[key] === true;
    }
    function rememberCollapsedId(id, collapsed) {
        const key = String(id || '').trim();
        if (!key) return;
        const data = readStore();
        if (collapsed) data[key] = true;
        else delete data[key];
        try { localStorage.setItem(storeKey(), JSON.stringify(data)); } catch (e) {}
    }
    function isCollapsed(root) {
        return isCollapsedId(messageId(root));
    }
    function setMessageCollapsed(id, collapsed) {
        const key = String(id || '').trim();
        if (!key) return;
        rememberCollapsedId(key, collapsed);
        try {
            document.dispatchEvent(new CustomEvent('chat:message-collapse', {
                detail: { id: key, collapsed: !!collapsed },
            }));
        } catch (e) {}
    }

    function preserve(container, anchor, fn) {
        if (!container || !anchor || !anchor.getBoundingClientRect) {
            fn();
            return;
        }
        const before = anchor.getBoundingClientRect().top;
        fn();
        const after = anchor.getBoundingClientRect().top;
        const delta = after - before;
        if (delta) container.scrollTop += delta;
    }

    function makeButton(cls, action, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.textContent = '收起';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        if (action) btn.dataset.action = action;
        return btn;
    }

    function ensurePreview(host, content, cls) {
        let preview = host.querySelector('.' + cls);
        if (!preview) {
            preview = document.createElement('div');
            preview.className = cls;
            content.parentNode.insertBefore(preview, content.nextSibling);
        }
        if (cls === 'msg-collapse-preview') {
            preview.dataset.action = 'toggle-message-collapse';
            preview.setAttribute('role', 'button');
            preview.setAttribute('tabindex', '0');
        }
        preview.textContent = previewText(content);
        return preview;
    }

    function messageParts(root) {
        const dm = root.classList.contains('dm-msg');
        return {
            dm: dm,
            header: root.querySelector(dm ? '.dm-msg-header' : '.msg-header'),
            content: root.querySelector(dm ? '.dm-bubble' : '.msg-content'),
            container: root.closest(dm ? '.dm-list' : '.message-list')
        };
    }

    function applyCollapsed(root, parts, btn, collapsed) {
        root.classList.toggle('msg-collapsed', collapsed);
        if (collapsed) ensurePreview(root, parts.content, 'msg-collapse-preview');
        if (!btn) return;
        btn.textContent = '折叠';
        btn.title = '折叠消息';
    }

    function avatarHost(root, parts) {
        if (parts.dm) return root.querySelector('.dm-avatar-wrap');
        const avatar = Array.from(root.children).find(function (el) {
            return el.classList && el.classList.contains('msg-avatar');
        });
        if (!avatar || !avatar.parentNode) return null;
        let col = avatar.parentNode;
        if (!col.classList.contains('msg-avatar-col')) {
            col = document.createElement('div');
            col.className = 'msg-avatar-col';
            avatar.parentNode.insertBefore(col, avatar);
            col.appendChild(avatar);
        }
        return col;
    }

    function enhanceMessage(root) {
        if (!root || !root.matches || !root.matches('.message, .dm-msg')) return;
        if (root.classList.contains('revoked-msg')) return;
        if (root.querySelector('.msg-edit-box')) return;
        const parts = messageParts(root);
        if (!parts.header || !parts.content || !parts.container) return;
        const host = avatarHost(root, parts);
        if (!host) return;
        let btn = host.querySelector('.msg-collapse-btn');
        if (!btn) {
            btn = makeButton('msg-collapse-btn msg-collapse-avatar-btn',
                'toggle-message-collapse', '折叠消息');
            btn.textContent = '折叠';
            host.appendChild(btn);
        }
        if (isCollapsed(root)) applyCollapsed(root, parts, btn, true);
    }

    function refreshMessage(root) {
        if (!root) return;
        const parts = messageParts(root);
        if (!parts.content) return;
        const preview = root.querySelector('.msg-collapse-preview');
        if (preview) preview.textContent = previewText(parts.content);
    }

    function toggleMessage(target) {
        const root = target && target.closest
            ? target.closest('.message, .dm-msg') : target;
        if (!root) return;
        if (root.querySelector('.msg-edit-box')) return;
        const parts = messageParts(root);
        if (!parts.content) return;
        const btn = root.querySelector('.msg-collapse-btn');
        const collapsed = !root.classList.contains('msg-collapsed');
        preserve(parts.container, parts.header || root, function () {
            applyCollapsed(root, parts, btn, collapsed);
        });
        setMessageCollapsed(messageId(root), collapsed);
    }

    function pinnedParts(root) {
        return {
            header: root.querySelector('.pinned-meta-top') || root.querySelector('.pinned-meta'),
            content: root.querySelector('.pinned-content'),
            container: root.closest('.pinned-panel')
        };
    }

    function enhancePinned(root) {
        if (!root || !root.matches || !root.matches('.pinned-item')) return;
        const parts = pinnedParts(root);
        if (!parts.header || !parts.content || !parts.container) return;
        if (parts.header.querySelector('.pinned-collapse-btn')) return;
        const btn = makeButton('pinned-collapse-btn', 'toggle-pinned-collapse', '折叠置顶消息');
        const src = parts.header.querySelector('.pinned-src-btn');
        if (src) parts.header.insertBefore(btn, src);
        else parts.header.appendChild(btn);
    }

    function refreshPinned(root) {
        if (!root) return;
        const parts = pinnedParts(root);
        if (!parts.content) return;
        const preview = root.querySelector('.pinned-collapse-preview');
        if (preview) preview.textContent = previewText(parts.content);
    }

    function togglePinned(target) {
        const root = target && target.closest
            ? target.closest('.pinned-item') : target;
        if (!root) return;
        const parts = pinnedParts(root);
        if (!parts.content) return;
        const btn = root.querySelector('.pinned-collapse-btn');
        const collapsed = !root.classList.contains('pinned-collapsed');
        preserve(parts.container, parts.header || root, function () {
            root.classList.toggle('pinned-collapsed', collapsed);
        });
        if (collapsed) ensurePreview(root, parts.content, 'pinned-collapse-preview');
        if (btn) {
            btn.textContent = collapsed ? '展开' : '收起';
            btn.title = collapsed ? '展开置顶消息' : '折叠置顶消息';
        }
    }

    function attachHistoryItem(item, meta, content) {
        if (!item || !meta || !content) return;
        if (item.querySelector('.history-collapse-btn')) return;
        const btn = makeButton('history-collapse-btn', '', '折叠版本');
        meta.appendChild(btn);
        const preview = document.createElement('div');
        preview.className = 'history-collapse-preview';
        preview.textContent = previewText(content);
        content.parentNode.insertBefore(preview, content.nextSibling);
        btn.addEventListener('click', function () {
            const collapsed = !item.classList.contains('history-collapsed');
            preserve(item.closest('.history-body'), item, function () {
                item.classList.toggle('history-collapsed', collapsed);
            });
            if (collapsed) preview.textContent = previewText(content);
            btn.textContent = collapsed ? '展开' : '收起';
            btn.title = collapsed ? '展开版本' : '折叠版本';
        });
    }

    function enhanceAll(container, selector, fn) {
        if (!container) return;
        if (container.matches && container.matches(selector)) fn(container);
        container.querySelectorAll(selector).forEach(fn);
    }

    function watch(container, selector, fn) {
        if (!container) return;
        enhanceAll(container, selector, fn);
        if (!window.MutationObserver) return;
        new MutationObserver(function (records) {
            records.forEach(function (record) {
                record.addedNodes.forEach(function (node) {
                    if (node.nodeType !== 1) return;
                    if (node.matches && node.matches(selector)) fn(node);
                    const owner = node.closest ? node.closest(selector) : null;
                    if (owner) fn(owner);
                    enhanceAll(node, selector, fn);
                });
            });
        }).observe(container, { childList: true, subtree: true });
    }

    document.addEventListener('chat:message-collapse', function (ev) {
        const detail = (ev && ev.detail) || {};
        const id = String(detail.id || '').trim();
        if (!id) return;
        const collapsed = !!detail.collapsed;
        document.querySelectorAll('.message[data-id], .dm-msg[data-id]')
            .forEach(function (root) {
                if (root.dataset.id !== id) return;
                if (root.querySelector('.msg-edit-box')) return;
                const parts = messageParts(root);
                if (!parts.content) return;
                applyCollapsed(root, parts,
                    root.querySelector('.msg-collapse-btn'), collapsed);
            });
    });

    window.toggleMessageCollapse = toggleMessage;
    window.togglePinnedCollapse = togglePinned;
    window.CollapseUI = {
        attachHistoryItem: attachHistoryItem,
        refreshMessage: refreshMessage,
        refreshPinned: refreshPinned,
        isMessageCollapsed: isCollapsedId,
        setMessageCollapsed: setMessageCollapsed,
        enhanceMessages: function (container) {
            enhanceAll(container || document, '.message, .dm-msg', enhanceMessage);
        }
    };
    R.enhanceCollapsible = function (container) {
        enhanceAll(container || document, '.message, .dm-msg', enhanceMessage);
    };

    watch(document.querySelector('.message-list'), '.message', enhanceMessage);
    watch(document.querySelector('.dm-list'), '.dm-msg', enhanceMessage);
    watch(document.querySelector('.pinned-panel'), '.pinned-item', enhancePinned);
})();

(function () {
    const R = window.ChatRender = window.ChatRender || {};

    function previewText() {
        return '消息已折叠';
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
    function isCollapsed(root) {
        const id = messageId(root);
        return !!id && readStore()[id] === true;
    }
    function rememberCollapsed(root, collapsed) {
        const id = messageId(root);
        if (!id) return;
        const data = readStore();
        if (collapsed) data[id] = true;
        else delete data[id];
        try { localStorage.setItem(storeKey(), JSON.stringify(data)); } catch (e) {}
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
        btn.textContent = collapsed ? '展开' : '收起';
        btn.title = collapsed ? '展开消息' : '折叠消息';
    }

    function enhanceMessage(root) {
        if (!root || !root.matches || !root.matches('.message, .dm-msg')) return;
        if (root.classList.contains('revoked-msg')) return;
        if (root.querySelector('.msg-edit-box')) return;
        const parts = messageParts(root);
        if (!parts.header || !parts.content || !parts.container) return;
        if (parts.header.querySelector('.msg-collapse-btn')) return;
        const btn = makeButton('msg-collapse-btn', 'toggle-message-collapse', '折叠消息');
        const actions = parts.header.querySelector('.msg-actions-left')
            || parts.header.querySelector('.msg-actions');
        if (actions) {
            const source = actions.querySelector('[data-action="toggle-source"]');
            if (source) actions.insertBefore(btn, source.nextSibling);
            else actions.appendChild(btn);
        } else {
            parts.header.appendChild(btn);
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
        rememberCollapsed(root, collapsed);
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

    window.toggleMessageCollapse = toggleMessage;
    window.togglePinnedCollapse = togglePinned;
    window.CollapseUI = {
        attachHistoryItem: attachHistoryItem,
        refreshMessage: refreshMessage,
        refreshPinned: refreshPinned,
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

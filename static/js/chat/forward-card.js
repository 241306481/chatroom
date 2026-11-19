(function () {
    function normalize(ref) {
        if (!ref || typeof ref !== 'object') return [];
        if (Array.isArray(ref.items) && ref.items.length) {
            return ref.items.filter(function (item) {
                return item && typeof item === 'object';
            });
        }
        if (!ref.id) return [];
        return [{ id: ref.id, origin: ref.origin || '', content: ref.content || '' }];
    }
    function isMerged(ref) {
        return normalize(ref).length > 1;
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
    function build(ref) {
        const items = normalize(ref);
        const first = items[0] || {};
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'forward-card';
        card.dataset.action = 'open-forward-card';
        card.dataset.forwardRef = JSON.stringify(ref || {});
        const icon = document.createElement('span');
        icon.className = 'forward-card-icon';
        icon.textContent = '🧾';
        const main = document.createElement('span');
        main.className = 'forward-card-main';
        const title = document.createElement('span');
        title.className = 'forward-card-title';
        title.textContent = '合并转发';
        const preview = document.createElement('span');
        preview.className = 'forward-card-preview';
        const origin = String(first.origin || '').trim();
        const body = excerpt(first.content || '', 80);
        preview.textContent = (origin ? origin + '：' : '') + (body || '查看聊天记录');
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
                if (el.dataset.forwardRendered === '1') return;
                let ref;
                try { ref = JSON.parse(el.dataset.forwardRef || ''); } catch (e) { return; }
                if (!isMerged(ref)) return;
                el.innerHTML = '';
                el.appendChild(build(ref));
                el.dataset.forwardRendered = '1';
                el.classList.add('forward-content-host');
            });
    }
    function closeOverlay(overlay) {
        if (overlay && overlay.parentNode) overlay.remove();
    }
    function open(ref) {
        const items = normalize(ref);
        if (!items.length) return;
        const old = document.querySelector('.forward-record-overlay');
        if (old) old.remove();
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay forward-record-overlay';
        const box = document.createElement('div');
        box.className = 'modal-box forward-record-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const header = document.createElement('div');
        header.className = 'modal-header';
        const icon = document.createElement('span');
        icon.className = 'modal-icon';
        icon.textContent = '🧾';
        const title = document.createElement('span');
        title.className = 'modal-title';
        title.textContent = '合并转发（' + items.length + ' 条）';
        header.appendChild(icon);
        header.appendChild(title);
        const body = document.createElement('div');
        body.className = 'modal-body forward-record-body';
        items.forEach(function (item, index) {
            const row = document.createElement('div');
            row.className = 'forward-record-item';
            const meta = document.createElement('div');
            meta.className = 'forward-record-origin';
            const order = document.createElement('span');
            order.className = 'forward-record-order';
            order.textContent = String(index + 1);
            const origin = document.createElement('span');
            origin.textContent = item.origin || '转发消息';
            meta.appendChild(order);
            meta.appendChild(origin);
            const content = document.createElement('div');
            content.className = 'forward-record-content md-body';
            content.innerHTML = window.renderContent
                ? window.renderContent(item.content || '')
                : window.esc(item.content || '');
            row.appendChild(meta);
            row.appendChild(content);
            body.appendChild(row);
        });
        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal-btn modal-btn-cancel';
        closeBtn.textContent = '关闭';
        footer.appendChild(closeBtn);
        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        requestAnimationFrame(function () { overlay.classList.add('show'); });
        function onKey(e) {
            if (e.key === 'Escape') close();
        }
        function close() {
            document.removeEventListener('keydown', onKey);
            closeOverlay(overlay);
        }
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

(function () {
    function decodePart(v) {
        try { return decodeURIComponent(v); } catch (e) { return v; }
    }
    function sourceOf(btn) {
        const dm = btn.closest ? btn.closest('.dm-msg') : null;
        if (dm) {
            return {
                type: 'dm',
                id: btn.dataset.id,
                peer: document.body.dataset.dmTarget || '',
            };
        }
        const message = btn.closest ? btn.closest('.message') : null;
        if (!message) return null;
        const m = location.pathname.match(/^\/domain\/([^/]+)\/discuss\/([^/]+)/);
        if (!m) return null;
        return {
            type: 'discuss',
            id: btn.dataset.id,
            domain: decodePart(m[1]),
            discuss: decodePart(m[2]),
        };
    }
    function closeOverlay(overlay) {
        if (overlay && overlay.parentNode) overlay.remove();
    }
    function openPicker(source, targets) {
        const old = document.querySelector('.forward-overlay');
        if (old) {
            if (old._close) old._close();
            else old.remove();
        }
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay forward-overlay';
        const box = document.createElement('div');
        box.className = 'modal-box forward-box';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const header = document.createElement('div');
        header.className = 'modal-header';
        const icon = document.createElement('span');
        icon.className = 'modal-icon';
        icon.textContent = '↪';
        const title = document.createElement('span');
        title.className = 'modal-title';
        title.textContent = '转发消息';
        header.appendChild(icon);
        header.appendChild(title);
        const body = document.createElement('div');
        body.className = 'modal-body';
        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'modal-input forward-search';
        search.placeholder = '搜索域或讨论';
        const list = document.createElement('div');
        list.className = 'forward-list';
        const empty = document.createElement('p');
        empty.className = 'forward-empty';
        empty.textContent = '没有可转发的讨论';
        body.appendChild(search);
        body.appendChild(list);
        body.appendChild(empty);
        const footer = document.createElement('div');
        footer.className = 'modal-footer';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'modal-btn modal-btn-cancel';
        cancel.textContent = '取消';
        footer.appendChild(cancel);
        box.appendChild(header);
        box.appendChild(body);
        box.appendChild(footer);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        let options = [];
        targets.forEach(function (group) {
            (group.discussions || []).forEach(function (d) {
                options.push({
                    domain: group.domain,
                    display: group.display || group.domain,
                    id: d.id,
                    title: d.title || d.id,
                    count: d.count || 0,
                });
            });
        });
        function render() {
            const q = search.value.trim().toLowerCase();
            list.innerHTML = '';
            let shown = 0;
            options.forEach(function (o) {
                const hay = (o.display + ' ' + o.domain + ' ' + o.title + ' ' + o.id).toLowerCase();
                if (q && hay.indexOf(q) < 0) return;
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'forward-target';
                const main = document.createElement('span');
                main.className = 'forward-target-name';
                main.textContent = o.display + ' / ' + o.title;
                const meta = document.createElement('span');
                meta.className = 'forward-target-meta';
                meta.textContent = o.id + ' · ' + o.count + ' 条消息';
                item.appendChild(main);
                item.appendChild(meta);
                item.addEventListener('click', function () {
                    submit(o, item);
                });
                list.appendChild(item);
                shown++;
            });
            empty.hidden = shown > 0;
        }
        function submit(target, item) {
            list.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
            item.classList.add('sending');
            const body = new URLSearchParams();
            body.set('message_id', source.id);
            body.set('source_type', source.type);
            body.set('target_domain', target.domain);
            body.set('target_disc', target.id);
            if (source.type === 'dm') {
                body.set('source_peer', source.peer);
            } else {
                body.set('source_domain', source.domain);
                body.set('source_disc', source.discuss);
            }
            fetch('/forward', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                },
                body: body.toString(),
            }).then(r => r.json().catch(function () {
                return { ok: false, error: '请求失败（' + r.status + '）' };
            })).then(function (res) {
                if (!res.ok) throw new Error(res.error || '转发失败');
                close();
                if (window.showToast) window.showToast('已转发到 ' + target.title);
            }).catch(function (err) {
                item.classList.remove('sending');
                list.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
                let tip = list.querySelector('.forward-error');
                if (!tip) {
                    tip = document.createElement('p');
                    tip.className = 'forward-error';
                    list.insertBefore(tip, list.firstChild);
                }
                tip.textContent = err.message || '转发失败';
            });
        }
        function onKey(e) {
            if (e.key === 'Escape') close();
        }
        function close() {
            document.removeEventListener('keydown', onKey);
            closeOverlay(overlay);
            delete overlay._close;
        }
        overlay._close = close;
        cancel.addEventListener('click', close);
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) close();
        });
        search.addEventListener('input', render);
        document.addEventListener('keydown', onKey);
        render();
        search.focus();
    }
    window.forwardMessage = function (id, btn) {
        const source = sourceOf(btn);
        if (!source || !source.id) return;
        if (!source.peer && source.type === 'dm') {
            if (window.showToast) window.showToast('当前没有私信会话');
            return;
        }
        fetch('/forward/targets', { headers: { 'Accept': 'application/json' } })
            .then(r => r.json().catch(function () {
                return { ok: false, error: '请求失败（' + r.status + '）' };
            })).then(function (res) {
                if (!res.ok) throw new Error(res.error || '加载失败');
                openPicker(source, Array.isArray(res.targets) ? res.targets : []);
            }).catch(function (err) {
                if (window.showToast) window.showToast(err.message || '加载失败');
            });
    };
})();

(function () {
    const AVATAR_EXTS = ['png', 'jpg', 'gif', 'webp'];
    function avatarSrc(user) {
        if (!user || !user.avatar_ext) return '';
        const ext = String(user.avatar_ext).toLowerCase();
        if (AVATAR_EXTS.indexOf(ext) < 0) return '';
        return '/avatar/' + encodeURIComponent(String(user.id)) + '/' + ext;
    }
    function avatarText(nickname) {
        const chars = Array.from(String(nickname == null ? '?' : nickname));
        if (!chars.length) return '?';
        const first = chars[0];
        const cp = first.codePointAt(0);
        if (cp > 0xFFFF) return first;
        if (/[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\uac00-\ud7af]/.test(first)) {
            return first;
        }
        return chars.slice(0, 2).join('');
    }
    function span(className, text) {
        const el = document.createElement('span');
        el.className = className;
        if (text != null) el.textContent = text;
        return el;
    }
    function badge(className, text) {
        return span('badge ' + className, text);
    }
    function ensureActions(row, user) {
        let actions = row.querySelector('.member-actions');
        if (user.is_owner) {
            if (actions) actions.remove();
            return;
        }
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'member-actions';
            actions.setAttribute('data-member-actions', '');
            row.appendChild(actions);
        }
        let btn = actions.querySelector('[data-action="mute-member"], [data-action="unmute-member"]');
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            actions.appendChild(btn);
        }
        const muted = !!user.is_muted;
        const label = muted ? '解禁' : '禁言';
        btn.dataset.action = muted ? 'unmute-member' : 'mute-member';
        btn.dataset.uid = String(user.id);
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.textContent = muted ? '🔓' : '🔇';
    }
    function updateRow(row, user) {
        const uid = String(user.id);
        row.dataset.uid = uid;
        row.className = 'member-item' + (user.online ? '' : ' offline');
        const dot = row.querySelector('.status-dot');
        if (dot) dot.className = 'status-dot ' + (user.online ? 'green' : 'red');
        const img = row.querySelector('img.avatar-img');
        if (img) {
            const src = avatarSrc(user);
            if (src) {
                if (img.getAttribute('src') !== src) img.setAttribute('src', src);
                img.style.display = '';
            } else {
                img.removeAttribute('src');
                img.style.display = 'none';
            }
        }
        const fallback = row.querySelector('span.member-avatar');
        if (fallback) {
            fallback.textContent = avatarText(user.nickname);
            fallback.style.background = user.avatar_color || '#888';
        }
        const name = row.querySelector('.member-name');
        if (name) {
            const nickname = user.nickname || '?';
            if (name.textContent !== nickname) name.textContent = nickname;
            name.setAttribute('href', window.userProfileUrl(uid));
        }
        const level = row.querySelector('.member-level');
        if (level) {
            const text = 'Lv.' + Number(user.level || 0);
            if (level.textContent !== text) level.textContent = text;
            level.dataset.exp = 'exp: ' + Number(user.exp || 0);
        }
        row.querySelectorAll('.badge').forEach(el => el.remove());
        let anchor = level || name;
        function insertBadge(className, text) {
            const el = badge(className, text);
            if (anchor && anchor.parentNode === row && anchor.nextSibling) {
                row.insertBefore(el, anchor.nextSibling);
            } else {
                row.appendChild(el);
            }
            anchor = el;
        }
        if (user.is_owner) insertBadge('owner', '所有者');
        else if (user.role === 'root') insertBadge('root', '管理员');
        if (user.is_mod) insertBadge('mod', 'MOD');
        if (user.is_banned) insertBadge('tag-banned', '已全域封禁');
        else if (user.banned) insertBadge('tag-banned', '已封禁');
        if (user.is_muted) insertBadge('tag-muted', '已禁言');
        ensureActions(row, user);
    }
    function createRow(user) {
        const row = document.createElement('div');
        row.appendChild(span('status-dot'));
        const img = document.createElement('img');
        img.className = 'member-avatar avatar-img';
        img.alt = '';
        img.setAttribute('loading', 'lazy');
        row.appendChild(img);
        row.appendChild(span('member-avatar'));
        const name = document.createElement('a');
        name.className = 'member-name';
        row.appendChild(name);
        row.appendChild(span('member-level'));
        updateRow(row, user);
        return row;
    }
    function apply(data) {
        const list = document.getElementById('memberList');
        if (!list || !data) return false;
        const members = Array.isArray(data.members) ? data.members : null;
        if (!members) {
            if (typeof data.html === 'string' && data.html) list.innerHTML = data.html;
        } else if (!members.length) {
            list.innerHTML = '<p class="empty">暂无成员</p>';
        } else {
            const empty = list.querySelector('.empty');
            if (empty) empty.remove();
            const existing = {};
            list.querySelectorAll('.member-item[data-uid]').forEach(row => {
                existing[row.dataset.uid] = row;
            });
            const seen = {};
            const rows = members.map(user => {
                const uid = String(user.id);
                seen[uid] = true;
                const row = existing[uid] || createRow(user);
                updateRow(row, user);
                return row;
            });
            Object.keys(existing).forEach(uid => {
                if (!seen[uid]) existing[uid].remove();
            });
            rows.forEach((row, index) => {
                const current = list.children[index];
                if (current !== row) list.insertBefore(row, current || null);
            });
        }
        if (typeof window.applyMemberPermissions === 'function') {
            window.applyMemberPermissions();
        } else if (window.__CAN_MUTE__ !== true && window.__CAN_MUTE__ !== 'true') {
            list.querySelectorAll('.member-actions').forEach(el => el.remove());
        }
        if (typeof window.updateAllOnlineCounts === 'function') {
            window.updateAllOnlineCounts();
        }
        return true;
    }
    window.MemberList = { apply, createRow, updateRow };
})();

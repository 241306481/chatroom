(function () {
    function span(className, text) {
        const el = document.createElement('span');
        el.className = className;
        if (text != null) el.textContent = text;
        return el;
    }
    function avatarText(nickname) {
        if (window.Avatar && window.Avatar.avatarText) {
            return window.Avatar.avatarText(nickname);
        }
        const chars = Array.from(String(nickname == null ? '?' : nickname));
        return chars.length ? chars[0] : '?';
    }
    function avatarSrc(user) {
        if (window.Avatar && window.Avatar.srcOf) return window.Avatar.srcOf(user);
        if (!user || !user.id || !user.avatar_ext) return '';
        return '/avatar/' + encodeURIComponent(String(user.id)) + '/'
            + encodeURIComponent(String(user.avatar_ext).toLowerCase());
    }
    function avatarColor(user) {
        if (window.Avatar && window.Avatar.safeColor) {
            return window.Avatar.safeColor(user && user.avatar_color);
        }
        return (user && user.avatar_color) || '#888';
    }
    function domainName() {
        return window.__DOMAIN__ || (document.body && document.body.dataset.domain) || '';
    }
    function compareDiscussions(a, b) {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        const aId = String(a.id);
        const bId = String(b.id);
        if (aId === 'general') return -1;
        if (bId === 'general') return 1;
        return aId.localeCompare(bId);
    }
    function homeUserRow(user) {
        const uid = String(user.id);
        const online = !!user.online;
        const row = document.createElement('a');
        row.href = window.userProfileUrl(uid);
        row.className = 'user-item' + (online ? '' : ' offline');
        row.dataset.uid = uid;
        row.style.textDecoration = 'none';
        row.style.color = 'inherit';
        row.appendChild(span('status-dot ' + (online ? 'green' : 'red')));
        if (window.Avatar && window.Avatar.build) {
            row.appendChild(window.Avatar.build(user, 'user-avatar'));
        } else {
            const src = avatarSrc(user);
            if (src) {
                const img = document.createElement('img');
                img.className = 'user-avatar avatar-img';
                img.alt = '';
                img.loading = 'lazy';
                img.src = src;
                row.appendChild(img);
            } else {
                const fallback = span('user-avatar', avatarText(user.nickname));
                fallback.style.background = avatarColor(user);
                row.appendChild(fallback);
            }
        }
        row.appendChild(span('user-name', user.nickname || '?'));
        const level = span('user-level', 'Lv.' + Number(user.level || 0));
        level.dataset.exp = 'exp: ' + Number(user.exp || 0);
        row.appendChild(level);
        return row;
    }
    function renderHomeMembers(data) {
        const list = document.getElementById('homeUserList');
        if (!list || !Array.isArray(data.members)) return false;
        const members = data.members;
        const total = Number.isFinite(Number(data.total_count))
            ? Number(data.total_count) : members.length;
        const online = Number.isFinite(Number(data.online_count))
            ? Number(data.online_count) : members.filter(u => u.online).length;
        list.textContent = '';
        if (!members.length) {
            const empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = '暂无成员，等待管理员邀请';
            list.appendChild(empty);
        } else {
            members.slice(0, 15).forEach(user => list.appendChild(homeUserRow(user)));
            if (total > 15) {
                const more = document.createElement('div');
                more.className = 'online-count';
                more.style.borderTop = 'none';
                more.style.color = '#1890ff';
                const link = document.createElement('a');
                link.href = '/domain/' + encodeURIComponent(domainName()) + '/users';
                link.style.color = '#1890ff';
                link.style.textDecoration = 'none';
                link.textContent = '还有 ' + (total - 15) + ' 位成员 →';
                more.appendChild(link);
                list.appendChild(more);
            }
        }
        const counter = document.querySelector('[data-home-online-count]');
        if (counter) counter.textContent = '在线 ' + online + ' / ' + total;
        try {
            window.__onlineUsers = new Set(
                members.filter(u => u.online).map(u => String(u.id)));
        } catch (e) {}
        return true;
    }
    let homeItems = null;
    function readHomeItems() {
        if (homeItems) return homeItems;
        const source = Array.isArray(window.__HOME_DISCUSSIONS__)
            ? window.__HOME_DISCUSSIONS__ : [];
        homeItems = source.map(item => ({
            id: String(item.id),
            title: item.title || '',
            count: Number(item.reply_count || item.count || 0),
            pinned: !!item.pinned,
        }));
        if (!homeItems.length) {
            const section = document.getElementById('homeDiscussionList');
            if (section) {
                homeItems = Array.from(section.querySelectorAll('.discussion-card[data-disc-id]'))
                    .map(card => ({
                        id: card.dataset.discId,
                        title: card.dataset.discTitle || '',
                        count: Number(card.dataset.discCount || 0),
                        pinned: card.dataset.discPinned === '1',
                    }));
            }
        }
        return homeItems;
    }
    function homeDiscussionCard(item) {
        const dn = domainName();
        const card = document.createElement('a');
        card.href = '/domain/' + encodeURIComponent(dn)
            + '/discuss/' + encodeURIComponent(item.id);
        card.className = 'discussion-card';
        card.dataset.discId = item.id;
        card.dataset.discTitle = item.title || '';
        card.dataset.discCount = String(item.count || 0);
        card.dataset.discPinned = item.pinned ? '1' : '0';
        card.appendChild(span('disc-name', '#' + item.id));
        if (item.title) card.appendChild(span('disc-title-inline', item.title));
        card.appendChild(span('disc-count', (item.count || 0) + ' 条'));
        return card;
    }
    function renderHomeDiscussions(items) {
        const section = document.getElementById('homeDiscussionList');
        if (!section) return false;
        items.sort(compareDiscussions);
        const heading = section.querySelector('h2');
        Array.from(section.children).forEach(child => {
            if (child !== heading) child.remove();
        });
        const total = items.length;
        const fragment = document.createDocumentFragment();
        if (!total) {
            const empty = document.createElement('p');
            empty.className = 'empty';
            empty.textContent = '暂无讨论，点击上方「讨论」进入后新建';
            fragment.appendChild(empty);
        } else {
            items.slice(0, 5).forEach(item => fragment.appendChild(homeDiscussionCard(item)));
        }
        const more = document.createElement('a');
        more.href = '/domain/' + encodeURIComponent(domainName()) + '/discuss';
        more.className = 'discussion-more';
        more.textContent = total > 5
            ? '还有 ' + (total - 5) + ' 个讨论… 查看全部' : '';
        more.hidden = total <= 5;
        fragment.appendChild(more);
        section.appendChild(fragment);
        section.dataset.total = String(total);
        return true;
    }
    function updateHomeCardCount(id, count) {
        if (count == null) return false;
        const section = document.getElementById('homeDiscussionList');
        if (!section) return false;
        const card = section.querySelector(
            '.discussion-card[data-disc-id="' + String(id) + '"]');
        if (!card) return false;
        card.dataset.discCount = String(Number(count) || 0);
        const meta = card.querySelector('.disc-count');
        if (meta) meta.textContent = (Number(count) || 0) + ' 条';
        return true;
    }
    function applyHomeDiscussion(data) {
        if (!document.getElementById('homeDiscussionList')) return false;
        const items = readHomeItems();
        if (data.type === 'discussion_created') {
            if (!items.some(item => item.id === String(data.id))) {
                items.push({
                    id: String(data.id),
                    title: data.title || '',
                    count: Number(data.count || 0),
                    pinned: !!data.pinned,
                });
            }
        } else if (data.type === 'discussion_deleted') {
            const id = String(data.id);
            for (let i = items.length - 1; i >= 0; i--) {
                if (items[i].id === id) items.splice(i, 1);
            }
        } else if (data.type === 'discussion_updated') {
            if (data.old_id && String(data.old_id) !== String(data.id)) {
                const oldId = String(data.old_id);
                for (let i = items.length - 1; i >= 0; i--) {
                    if (items[i].id === oldId) items.splice(i, 1);
                }
            }
            let item = items.find(entry => entry.id === String(data.id));
            if (!item) {
                item = { id: String(data.id), title: '', count: 0, pinned: false };
                items.push(item);
            }
            if (data.title != null) item.title = data.title;
            if (data.count != null) item.count = Number(data.count);
            if (data.pinned != null) item.pinned = !!data.pinned;
        } else if (data.type === 'discussion_activity') {
            const item = items.find(entry => entry.id === String(data.id));
            if (item && data.count != null) item.count = Number(data.count);
            return updateHomeCardCount(data.id, data.count);
        }
        return renderHomeDiscussions(items);
    }
    function discussRow(item) {
        const dn = domainName();
        const wrap = document.createElement('div');
        wrap.className = 'discuss-row-wrap';
        wrap.dataset.discId = item.id;
        wrap.dataset.discTitle = item.title || '';
        wrap.dataset.discCount = String(item.count || 0);
        wrap.dataset.discPinned = item.pinned ? '1' : '0';
        const link = document.createElement('a');
        link.href = '/domain/' + encodeURIComponent(dn)
            + '/discuss/' + encodeURIComponent(item.id);
        link.className = 'discuss-row';
        const left = document.createElement('div');
        left.className = 'discuss-row-left';
        if (item.pinned) left.appendChild(span('pinned-badge', '置顶'));
        const idSpan = span('discuss-id', '#' + item.id);
        idSpan.dataset.oldId = item.id;
        idSpan.dataset.value = item.id;
        if (window.__CAN_EDIT_DISCUSS__ === true && item.id !== 'general') {
            idSpan.dataset.action = 'inline-edit-id';
        }
        left.appendChild(idSpan);
        const title = span('discuss-title' + (item.title ? '' : ' empty'),
            item.title || '（无标题）');
        title.dataset.id = item.id;
        title.dataset.value = item.title || '';
        if (window.__CAN_EDIT_DISCUSS__ === true) {
            title.dataset.action = 'inline-edit-title';
        }
        left.appendChild(title);
        link.appendChild(left);
        link.appendChild(span('meta', (item.count || 0) + ' 条'));
        wrap.appendChild(link);
        if (window.__CAN_DELETE_DISCUSS__ === true && item.id !== 'general') {
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'discuss-del-btn';
            del.dataset.disc = item.id;
            del.dataset.action = 'delete-discussion';
            del.title = '删除';
            del.textContent = '🗑️';
            wrap.appendChild(del);
        }
        return wrap;
    }
    function updateDiscussRow(wrap, item) {
        const dn = domainName();
        wrap.dataset.discId = item.id;
        wrap.dataset.discTitle = item.title || '';
        wrap.dataset.discCount = String(item.count || 0);
        wrap.dataset.discPinned = item.pinned ? '1' : '0';
        const link = wrap.querySelector('.discuss-row');
        if (link) {
            link.href = '/domain/' + encodeURIComponent(dn)
                + '/discuss/' + encodeURIComponent(item.id);
        }
        let badge = wrap.querySelector('.pinned-badge');
        if (item.pinned && !badge) {
            badge = span('pinned-badge', '置顶');
            const left = wrap.querySelector('.discuss-row-left');
            if (left) left.insertBefore(badge, left.firstChild);
        } else if (!item.pinned && badge) {
            badge.remove();
        }
        const idSpan = wrap.querySelector('.discuss-id');
        if (idSpan) {
            idSpan.textContent = '#' + item.id;
            idSpan.dataset.oldId = item.id;
            idSpan.dataset.value = item.id;
        }
        const title = wrap.querySelector('.discuss-title');
        if (title) {
            title.textContent = item.title || '（无标题）';
            title.dataset.id = item.id;
            title.dataset.value = item.title || '';
            title.classList.toggle('empty', !item.title);
        }
        const meta = wrap.querySelector('.meta');
        if (meta) meta.textContent = (item.count || 0) + ' 条';
        const del = wrap.querySelector('.discuss-del-btn');
        if (del) del.dataset.disc = item.id;
    }
    function ensureDiscussEmpty(container) {
        const rows = container.querySelectorAll('.discuss-row-wrap');
        const empty = container.querySelector('.empty');
        if (rows.length && empty) empty.remove();
        if (!rows.length && !empty) {
            const p = document.createElement('p');
            p.className = 'empty';
            p.textContent = container.dataset.emptyText || '暂无讨论';
            container.appendChild(p);
        }
    }
    function sortDiscussRows(container) {
        const rows = Array.from(container.querySelectorAll('.discuss-row-wrap'));
        if (rows.length < 2) return;
        const desired = rows.slice().sort((a, b) => compareDiscussions(
            { id: a.dataset.discId, pinned: a.dataset.discPinned === '1' },
            { id: b.dataset.discId, pinned: b.dataset.discPinned === '1' }));
        if (desired.every((row, index) => row === rows[index])) return;
        desired.forEach(row => container.appendChild(row));
    }
    function applyDiscussList(data) {
        const container = document.querySelector('[data-discuss-list]');
        if (!container) return false;
        const id = String(data.id || '');
        if (!id) return false;
        if (data.type === 'discussion_created' || data.type === 'discussion_updated') {
            if (data.old_id && String(data.old_id) !== id) {
                const old = container.querySelector(
                    '.discuss-row-wrap[data-disc-id="' + String(data.old_id) + '"]');
                if (old) old.remove();
            }
            let row = container.querySelector(
                '.discuss-row-wrap[data-disc-id="' + id + '"]');
            if (!row) {
                row = discussRow({
                    id,
                    title: data.title || '',
                    count: Number(data.count || 0),
                    pinned: data.pinned != null ? !!data.pinned : false,
                });
                container.appendChild(row);
            } else {
                updateDiscussRow(row, {
                    id,
                    title: data.title != null
                        ? data.title : row.dataset.discTitle || '',
                    count: data.count != null
                        ? Number(data.count) : Number(row.dataset.discCount || 0),
                    pinned: data.pinned != null
                        ? !!data.pinned : row.dataset.discPinned === '1',
                });
            }
        } else if (data.type === 'discussion_deleted') {
            const row = container.querySelector(
                '.discuss-row-wrap[data-disc-id="' + id + '"]');
            if (row) row.remove();
        } else if (data.type === 'discussion_activity') {
            const row = container.querySelector(
                '.discuss-row-wrap[data-disc-id="' + id + '"]');
            if (row) {
                row.dataset.discCount = String(data.count || 0);
                const meta = row.querySelector('.meta');
                if (meta) meta.textContent = (Number(data.count) || 0) + ' 条';
            }
        }
        if (data.type !== 'discussion_activity') sortDiscussRows(container);
        ensureDiscussEmpty(container);
        if (window.DiscussListFilter && window.DiscussListFilter.refresh) {
            window.DiscussListFilter.refresh();
        }
        return true;
    }
    window.addEventListener('chatroom:domain-event', function (event) {
        const data = event && event.detail;
        if (!data || !data.type) return;
        if (data.type === 'members_update') renderHomeMembers(data);
        else if (data.type === 'discussion_created'
            || data.type === 'discussion_deleted'
            || data.type === 'discussion_updated'
            || data.type === 'discussion_activity') {
            applyHomeDiscussion(data);
            applyDiscussList(data);
        }
    });
})();

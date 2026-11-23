(function () {
    const PAGE_SIZE = 48;
    const REACTION_GROUPS = [
        {
            id: 'common',
            label: '常用',
            emojis: ['👍', '👎', '❤️', '🎉', '😂', '😮', '😢', '🔥', '👀', '✅',
                '🤔', '😄', '😀', '🤤', '😅'],
        },
        {
            id: 'smile',
            label: '笑脸',
            emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
                '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️',
                '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗',
                '🤭', '🤫', '🤔', '😎', '🤓', '🧐'],
        },
        {
            id: 'mood',
            label: '情绪',
            emojis: ['🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄',
                '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒',
                '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯',
                '🤠', '🥳', '😕', '😟', '🙁', '☹️', '😮', '😯',
                '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢',
                '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤',
                '😡', '😠', '🤬'],
        },
        {
            id: 'funny',
            label: '搞怪',
            emojis: ['😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽',
                '👾', '🤖'],
        },
        {
            id: 'animal',
            label: '动物',
            emojis: ['😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
                '🙈', '🙉', '🙊'],
        },
        {
            id: 'heart',
            label: '爱心',
            emojis: ['💋', '💌', '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟',
                '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙', '💜',
                '🤎', '🖤', '🤍'],
        },
        {
            id: 'symbol',
            label: '符号',
            emojis: ['💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️',
                '🗨️', '🗯️', '💭', '💤'],
        },
    ];

    function positionPicker(picker, btn) {
        const r = btn.getBoundingClientRect();
        const pw = picker.offsetWidth;
        const ph = picker.offsetHeight;
        const vw = document.documentElement.clientWidth;
        const vh = window.innerHeight;
        let left = r.left + r.width / 2 - pw / 2;
        const minLeft = 8;
        const maxLeft = vw - pw - 8;
        if (left < minLeft) left = minLeft;
        if (left > maxLeft) left = maxLeft;
        const spaceBelow = vh - r.bottom;
        const spaceAbove = r.top;
        let top;
        if (spaceBelow >= ph + 12 || spaceBelow >= spaceAbove) {
            top = r.bottom + 4;
        } else {
            top = r.top - ph - 4;
        }
        if (top + ph > vh - 8) top = vh - ph - 8;
        if (top < 8) top = 8;
        picker.style.left = left + 'px';
        picker.style.top = top + 'px';
    }

    window.sendReaction = function (id, emoji) {
        if (window.ChatWS && window.ChatWS.send) {
            window.ChatWS.send({ type: 'reaction', message_id: id, emoji });
        }
    };
    window.toggleReactionPicker = function (msgId, btn) {
        const existId = 'reaction-picker-' + msgId;
        const existing = document.getElementById(existId);
        if (existing) {
            if (existing.__teardown) existing.__teardown();
            else existing.remove();
            return;
        }
        const picker = document.createElement('div');
        picker.id = existId;
        picker.className = 'reaction-picker';
        picker.setAttribute('role', 'dialog');
        picker.setAttribute('aria-label', '选择表情');
        let close = null;
        let closeTimer = null;
        let groupIndex = 0;
        let page = 0;
        const teardown = function () {
            if (close) { document.removeEventListener('click', close, true); close = null; }
            if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
            document.removeEventListener('keydown', onKeydown);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('scroll', onScroll);
            if (picker.parentNode) picker.remove();
        };
        const onKeydown = function (ev) {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                teardown();
            }
        };
        const onResize = function () {
            positionPicker(picker, btn);
        };
        const onScroll = function () {
            teardown();
        };
        const openPickers = document.querySelectorAll('.reaction-picker');
        for (const el of openPickers) {
            if (el !== picker && el.__teardown) el.__teardown();
            el.remove();
        }
        const tabs = document.createElement('div');
        tabs.className = 'reaction-tabs';
        tabs.setAttribute('role', 'tablist');
        const grid = document.createElement('div');
        grid.className = 'reaction-grid';
        const pager = document.createElement('div');
        pager.className = 'reaction-pager';
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'reaction-page-btn';
        prev.textContent = '‹';
        prev.setAttribute('aria-label', '上一页');
        const pageInfo = document.createElement('span');
        pageInfo.className = 'reaction-page-info';
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'reaction-page-btn';
        next.textContent = '›';
        next.setAttribute('aria-label', '下一页');
        pager.appendChild(prev);
        pager.appendChild(pageInfo);
        pager.appendChild(next);
        picker.appendChild(tabs);
        picker.appendChild(grid);
        picker.appendChild(pager);

        function renderTabs() {
            tabs.innerHTML = '';
            REACTION_GROUPS.forEach(function (group, index) {
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'reaction-tab' + (index === groupIndex ? ' active' : '');
                tab.textContent = group.label;
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-selected', index === groupIndex ? 'true' : 'false');
                tab.addEventListener('click', function () {
                    groupIndex = index;
                    page = 0;
                    render();
                    const active = tabs.children[groupIndex];
                    if (active && typeof active.focus === 'function') {
                        active.focus({ preventScroll: true });
                    }
                });
                tabs.appendChild(tab);
            });
        }
        function renderGrid() {
            const group = REACTION_GROUPS[groupIndex];
            const totalPages = Math.max(1, Math.ceil(group.emojis.length / PAGE_SIZE));
            if (page >= totalPages) page = totalPages - 1;
            grid.innerHTML = '';
            group.emojis.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                .forEach(function (emoji) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'reaction-emoji-btn';
                    b.textContent = emoji;
                    b.title = emoji;
                    b.setAttribute('aria-label', emoji);
                    b.addEventListener('click', function () {
                        window.sendReaction(msgId, emoji);
                        teardown();
                    });
                    grid.appendChild(b);
                });
            pager.hidden = totalPages <= 1;
            pageInfo.textContent = (page + 1) + ' / ' + totalPages;
            prev.disabled = page <= 0;
            next.disabled = page >= totalPages - 1;
        }
        function render() {
            renderTabs();
            renderGrid();
            positionPicker(picker, btn);
        }
        prev.addEventListener('click', function () {
            if (page > 0) { page -= 1; render(); }
        });
        next.addEventListener('click', function () {
            const totalPages = Math.ceil(
                REACTION_GROUPS[groupIndex].emojis.length / PAGE_SIZE);
            if (page < totalPages - 1) { page += 1; render(); }
        });
        document.body.appendChild(picker);
        picker.__teardown = teardown;
        render();
        requestAnimationFrame(function () { positionPicker(picker, btn); });
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onScroll, { passive: true });
        document.addEventListener('keydown', onKeydown);
        closeTimer = setTimeout(function () {
            closeTimer = null;
            if (!picker.parentNode) return;
            close = function (ev) {
                if (!picker.contains(ev.target) && ev.target !== btn) {
                    teardown();
                }
            };
            document.addEventListener('click', close, true);
        }, 0);
    };
})();

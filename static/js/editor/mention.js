'use strict';

(function () {
    const candidates = window.__MENTION_CANDIDATES__ || [];
    if (!candidates.length) return;

    function attach(ta) {
        if (!ta || ta._mentionBound) return;
        ta._mentionBound = true;

        const box = document.createElement('div');
        box.className = 'mention-picker';
        box.hidden = true;
        document.body.appendChild(box);

        let activeIdx = 0;
        let matches = [];

        function getQueryAndStart() {
            const pos = ta.selectionStart;
            const before = ta.value.substring(0, pos);
            const m = before.match(/(@(@?))([^\s@\[\]]*)$/);
            if (!m) return null;
            return {
                query: m[3],
                start: pos - m[0].length,
                silent: m[2] === '@',
            };
        }

        function render() {
            if (!matches.length) { box.hidden = true; return; }
            box.innerHTML = '';
            matches.forEach((c, i) => {
                const item = document.createElement('div');
                item.className = 'mention-picker-item' + (i === activeIdx ? ' active' : '');
                item.textContent = c.nickname + ' (uid:' + c.id + ')';
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    pick(i);
                });
                box.appendChild(item);
            });
            const r = ta.getBoundingClientRect();
            box.style.position = 'fixed';
            box.style.left = r.left + 'px';
            box.style.top = (r.bottom + 4) + 'px';
            box.style.maxHeight = '200px';
            box.style.overflowY = 'auto';
            box.hidden = false;
        }

        function pick(idx) {
            const info = getQueryAndStart();
            if (!info) { box.hidden = true; return; }
            const c = matches[idx];
            if (!c) return;
            const prefix = info.silent ? '@@[' : '@[';
            const insert = prefix + c.id + '] ';
            const pos = ta.selectionStart;
            ta.value = ta.value.substring(0, info.start) + insert + ta.value.substring(pos);
            const newPos = info.start + insert.length;
            ta.selectionStart = ta.selectionEnd = newPos;
            ta.focus();
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            box.hidden = true;
        }

        ta.addEventListener('input', () => {
            const info = getQueryAndStart();
            if (!info) { box.hidden = true; return; }
            const q = info.query.toLowerCase();
            matches = candidates.filter(c =>
                c.nickname.toLowerCase().indexOf(q) >= 0
            ).slice(0, 20);
            activeIdx = 0;
            render();
        });

        ta.addEventListener('keydown', (e) => {
            if (box.hidden) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIdx = Math.min(activeIdx + 1, matches.length - 1);
                render();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIdx = Math.max(activeIdx - 1, 0);
                render();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (matches.length) {
                    e.preventDefault();
                    pick(activeIdx);
                }
            } else if (e.key === 'Escape') {
                box.hidden = true;
            }
        });

        ta.addEventListener('blur', () => {
            setTimeout(() => { box.hidden = true; }, 150);
        });
    }

    window.MentionPicker = { attach };
})();

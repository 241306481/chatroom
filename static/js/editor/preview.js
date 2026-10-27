window.EditorPreview = {
    attach({ ta, preview, counter, wrapper }) {
        let lastText = null;
        let frame = 0;
        function nodeKey(node) {
            return node.nodeType + ':' + (node.outerHTML || node.nodeValue || '');
        }
        function buildNodes(text) {
            const tpl = document.createElement('template');
            tpl.innerHTML = window.renderContent(text);
            return Array.from(tpl.content.childNodes);
        }
        function patchNodes(nodes) {
            const oldNodes = Array.from(preview.childNodes);
            const oldKeys = oldNodes.map(nodeKey);
            const newKeys = nodes.map(nodeKey);
            const n = oldNodes.length;
            const m = nodes.length;
            const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
            for (let i = n - 1; i >= 0; i--) {
                for (let j = m - 1; j >= 0; j--) {
                    dp[i][j] = oldKeys[i] === newKeys[j]
                        ? dp[i + 1][j + 1] + 1
                        : Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
            let i = 0;
            let j = 0;
            while (i < n && j < m) {
                if (oldKeys[i] === newKeys[j]) {
                    i++;
                    j++;
                } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                    oldNodes[i].remove();
                    i++;
                } else {
                    preview.insertBefore(nodes[j], oldNodes[i] || null);
                    j++;
                }
            }
            while (i < n) oldNodes[i++].remove();
            while (j < m) preview.appendChild(nodes[j++]);
        }
        function clearPreview() {
            while (preview.firstChild) preview.removeChild(preview.firstChild);
        }
        function render() {
            if (wrapper && wrapper.classList.contains('md-editor-preview-hidden')) return;
            const text = ta.value;
            if (text === lastText) return;
            const top = preview.scrollTop;
            if (!text.trim()) {
                clearPreview();
                lastText = text;
                return;
            }
            patchNodes(buildNodes(text));
            preview.scrollTop = top;
            lastText = text;
        }
        function updateCounter() {
            if (counter) counter.textContent = String(ta.value.length);
        }
        function refresh() {
            render();
            updateCounter();
        }
        function schedule() {
            if (frame) return;
            frame = window.requestAnimationFrame(function () {
                frame = 0;
                refresh();
            });
        }
        ta.addEventListener('input', schedule);
        refresh();
        return { render, refresh, updateCounter };
    },
};

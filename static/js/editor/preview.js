window.EditorPreview = {
    attach({ ta, preview, counter, lineNumbers, lineCount, wrapper }) {
        let lastText = null;
        let lastStatsText = null;
        let lastStatsWidth = -1;
        let lineMeasure = null;
        let frame = 0;
        function nodeKey(node) {
            if (node.nodeType === 1) {
                return '1:' + node.tagName + ':' + (node.id || '') + ':'
                    + (node.getAttribute('class') || '');
            }
            return node.nodeType + ':' + (node.nodeValue || '');
        }
        function syncAttrs(oldNode, newNode) {
            for (const attr of Array.from(oldNode.attributes)) {
                if (!newNode.hasAttribute(attr.name)) oldNode.removeAttribute(attr.name);
            }
            for (const attr of Array.from(newNode.attributes)) {
                if (oldNode.getAttribute(attr.name) !== attr.value) {
                    oldNode.setAttribute(attr.name, attr.value);
                }
            }
        }
        function morphNode(oldNode, newNode) {
            if (oldNode.nodeType !== newNode.nodeType) {
                oldNode.parentNode.replaceChild(newNode, oldNode);
                return;
            }
            if (oldNode.nodeType === 3) {
                if (oldNode.nodeValue !== newNode.nodeValue) oldNode.nodeValue = newNode.nodeValue;
                return;
            }
            if (oldNode.nodeType !== 1) return;
            if (oldNode.tagName !== newNode.tagName) {
                oldNode.parentNode.replaceChild(newNode, oldNode);
                return;
            }
            const keepOpen = oldNode.tagName === 'DETAILS' && oldNode.open;
            syncAttrs(oldNode, newNode);
            if (oldNode.tagName === 'DETAILS'
                && (keepOpen || newNode.hasAttribute('open'))) {
                oldNode.open = true;
            }
            patchChildren(oldNode, Array.from(newNode.childNodes));
        }
        function buildNodes(text) {
            const tpl = document.createElement('template');
            tpl.innerHTML = window.renderContent(text);
            return Array.from(tpl.content.childNodes);
        }
        function patchChildren(parent, nodes) {
            const oldNodes = Array.from(parent.childNodes);
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
                    morphNode(oldNodes[i], nodes[j]);
                    i++;
                    j++;
                } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                    oldNodes[i].remove();
                    i++;
                } else {
                    parent.insertBefore(nodes[j], oldNodes[i] || null);
                    j++;
                }
            }
            while (i < n) oldNodes[i++].remove();
            while (j < m) parent.appendChild(nodes[j++]);
        }
        function patchNodes(nodes) {
            patchChildren(preview, nodes);
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
        function getLineMeasure() {
            if (lineMeasure && lineMeasure.parentNode) return lineMeasure;
            lineMeasure = document.createElement('div');
            lineMeasure.className = 'md-editor-line-measure';
            document.body.appendChild(lineMeasure);
            return lineMeasure;
        }
        function measureLineRows(lines) {
            const cs = window.getComputedStyle(ta);
            const width = ta.clientWidth - parseFloat(cs.paddingLeft)
                - parseFloat(cs.paddingRight);
            if (!(width > 0)) return lines.map(() => 1);
            const measure = getLineMeasure();
            measure.style.width = width + 'px';
            measure.style.fontFamily = cs.fontFamily;
            measure.style.fontSize = cs.fontSize;
            measure.style.fontWeight = cs.fontWeight;
            measure.style.fontStyle = cs.fontStyle;
            measure.style.letterSpacing = cs.letterSpacing;
            measure.style.lineHeight = cs.lineHeight;
            measure.style.tabSize = cs.tabSize;
            measure.style.textTransform = cs.textTransform;
            measure.style.wordSpacing = cs.wordSpacing;
            measure.style.direction = cs.direction;
            const frag = document.createDocumentFragment();
            const divs = lines.map(line => {
                const div = document.createElement('div');
                div.textContent = line || '\u200b';
                frag.appendChild(div);
                return div;
            });
            measure.replaceChildren(frag);
            const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6 || 22.4;
            return divs.map(div => Math.max(1,
                Math.round(div.getBoundingClientRect().height / lineHeight)));
        }
        function renderLineNumbers(lines) {
            const rows = measureLineRows(lines);
            const frag = document.createDocumentFragment();
            for (let i = 0; i < lines.length; i++) {
                for (let r = 0; r < rows[i]; r++) {
                    const span = document.createElement('span');
                    if (r === 0) span.textContent = String(i + 1);
                    frag.appendChild(span);
                }
            }
            lineNumbers.replaceChildren(frag);
            lineNumbers.scrollTop = ta.scrollTop;
        }
        function updateStats() {
            const text = ta.value;
            const lines = text.split('\n');
            if (lineCount) lineCount.textContent = String(lines.length);
            if (counter) counter.textContent = String(text.length);
            if (!lineNumbers) return;
            const gutterWidth = Math.max(3.5, String(lines.length).length + 2.5) + 'ch';
            if (lineNumbers.style.width !== gutterWidth) lineNumbers.style.width = gutterWidth;
            const width = ta.clientWidth;
            if (text === lastStatsText && width === lastStatsWidth) return;
            lastStatsText = text;
            lastStatsWidth = width;
            renderLineNumbers(lines);
        }
        function syncLineNumbers() {
            if (lineNumbers) lineNumbers.scrollTop = ta.scrollTop;
        }
        function refresh() {
            render();
            updateStats();
        }
        function schedule() {
            if (frame) return;
            frame = window.requestAnimationFrame(function () {
                frame = 0;
                refresh();
            });
        }
        ta.addEventListener('input', schedule);
        ta.addEventListener('scroll', syncLineNumbers);
        if (lineNumbers && typeof window.ResizeObserver === 'function') {
            new window.ResizeObserver(() => updateStats()).observe(ta);
        }
        refresh();
        return { render, refresh, updateStats };
    },
};

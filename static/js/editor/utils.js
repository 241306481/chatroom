// 纯文本工具
window.EditorUtils = {
    surround(ta, before, after, placeholder) {
        const s = ta.selectionStart, e = ta.selectionEnd;
        const sel = ta.value.substring(s, e) || placeholder || '';
        ta.value = ta.value.substring(0, s) + before + sel + after + ta.value.substring(e);
        ta.focus();
        ta.selectionStart = s + before.length;
        ta.selectionEnd = s + before.length + sel.length;
    },

    insertAt(ta, text) {
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + text + ta.value.substring(e);
        ta.focus();
        const pos = s + text.length;
        ta.selectionStart = ta.selectionEnd = pos;
    },

    togglePrefix(ta, prefix) {
        const s = ta.selectionStart, e = ta.selectionEnd;
        const v = ta.value;
        const ls = s === 0 ? 0 : v.lastIndexOf('\n', s - 1) + 1;
        let le = v.indexOf('\n', e);
        if (le === -1) le = v.length;
        const block = v.substring(ls, le);
        const lines = block.split('\n');
        const allHave = lines.every(l => l.startsWith(prefix));
        const newLines = lines.map(l => allHave ? l.substring(prefix.length) : prefix + l);
        const newBlock = newLines.join('\n');
        ta.value = v.substring(0, ls) + newBlock + v.substring(le);
        ta.focus();
        ta.selectionStart = ls;
        ta.selectionEnd = ls + newBlock.length;
    },

    wrapCode(ta) {
        const s = ta.selectionStart, e = ta.selectionEnd;
        const sel = ta.value.substring(s, e);
        this.insertAt(ta, '```\n' + sel + '\n```');
    },

    wrapKatexBlock(ta) {
        const s = ta.selectionStart, e = ta.selectionEnd;
        const sel = ta.value.substring(s, e);
        this.insertAt(ta, '\n\n$$\n' + sel + '\n$$\n\n');
    },

    insertTable(ta, rows, cols) {
        const header = '| ' + Array.from({ length: cols }, (_, i) => '列' + (i + 1)).join(' | ') + ' |';
        const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
        const body = Array.from({ length: Math.max(0, rows - 1) },
            () => '| ' + Array.from({ length: cols }, () => '  ').join(' | ') + ' |').join('\n');
        const text = '\n\n' + header + '\n' + sep + (body ? '\n' + body : '') + '\n\n';
        this.insertAt(ta, text);
    },

    closeAll(root) {
        root.querySelectorAll('.md-editor-dropdown').forEach(d =>
            d.classList.add('md-editor-dropdown-hidden'));
        root.querySelectorAll('[data-action="dropdown"]').forEach(b =>
            b.classList.remove('md-editor-toolbar-active'));
    },
};
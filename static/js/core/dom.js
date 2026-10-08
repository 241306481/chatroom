// ============================================================
// 全局变量
// ============================================================
window.MY_UID = window.__CURRENT_UID__ || '';

// ============================================================
// HTML 转义
// ============================================================
window.esc = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
window.escAttr = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// ============================================================
// 内容渲染：Markdown + LaTeX
// ============================================================
window.renderContent = function (text) {
    if (text == null) return '';
    text = String(text);

    let html;
    if (typeof marked !== 'undefined') {
        try { html = marked.parse(text, { breaks: true, gfm: true }); }
        catch (e) { html = esc(text).replace(/\n/g, '<br>'); }
    } else {
        html = esc(text).replace(/\n/g, '<br>');
    }

    const container = document.createElement('div');
    container.innerHTML = html;
    sanitize(container);

    if (window.renderMathInElement) {
        try {
            renderMathInElement(container, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                    { left: '\\[', right: '\\]', display: true },
                ],
                ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
                throwOnError: false,
                trust: false,
            });
        } catch (e) {}
    }

    return container.innerHTML;

    function sanitize(root) {
        root.querySelectorAll('script, iframe, object, embed, link, meta, style, base, form')
            .forEach(n => n.remove());
        root.querySelectorAll('*').forEach(el => {
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                const value = String(attr.value || '');
                if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
                if ((name === 'href' || name === 'src' || name === 'xlink:href')
                    && /^\s*(javascript|data|vbscript):/i.test(value)) {
                    el.removeAttribute(attr.name);
                }
            }
        });
    }
};

// ============================================================
// 源码 / 渲染切换（供模板内联 onclick 调用）
// ============================================================
window.toggleSource = function (btn) {
    const wrap = btn.closest('.msg-body') || btn.closest('.dm-msg') || btn.closest('.md-editor-footer');
    if (!wrap) return;
    const el = wrap.querySelector('.msg-content')
            || wrap.querySelector('.dm-bubble')
            || wrap.querySelector('.md-editor-preview');
    if (!el) return;
    const raw = el.dataset.raw || el.textContent;
    if (el.dataset.mode === 'source') {
        el.innerHTML = window.renderContent ? window.renderContent(raw) : raw;
        el.dataset.mode = 'render';
        btn.textContent = '📄';
        btn.title = '查看源码';
    } else {
        el.textContent = raw;
        el.dataset.mode = 'source';
        btn.textContent = '👁';
        btn.title = '查看渲染';
    }
};
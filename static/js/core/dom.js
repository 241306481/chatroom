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
// 剪贴板
// ============================================================
window.copyToClipboard = function (text, btn) {
    const done = function () {
        if (!btn) return;
        const old = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = old; }, 1500);
    };
    function fallbackCopy(t) {
        const ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
            fallbackCopy(text);
            done();
        });
    } else {
        fallbackCopy(text);
        done();
    }
};

// 代码块复制按钮的点击处理：renderContent 返回的是 HTML 字符串，
// 按钮在调用方 innerHTML 赋值时会被重新解析，节点上的监听器无法保留，
// 因此统一在文档级做事件委托。
document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest('.code-copy-btn');
    if (!btn) return;
    const pre = btn.closest('pre');
    if (!pre) return;
    const code = pre.querySelector('code');
    window.copyToClipboard(code ? code.textContent : pre.textContent, btn);
});

// ============================================================
// 内容渲染：Markdown 解析 → DOM 上渲染 LaTeX
// ============================================================
window.renderContent = function (text) {
    if (text == null) return '';
    text = String(text);

    // ---- 1. 处理 @ 提及（在 marked 之前）----
    // 语法：@[uid] 或 @@[uid]
    // 用 HTML 注释占位，避免被 marked 解析为链接/强调
    const mentionPlaceholders = [];
    const processed = text.replace(/@(@?)\[(\d+)\]/g,
        (whole, at, uid) => {
            const idx = mentionPlaceholders.length;
            mentionPlaceholders.push({ uid: uid, silent: at === '@' });
            return '<!--MENTION_' + idx + '-->';
        });

    // ---- 2. Markdown 解析（breaks: false 保证公式内换行不被 <br> 破坏）----
    let html;
    if (typeof marked !== 'undefined') {
        try {
            html = marked.parse(processed, { breaks: false, gfm: true });
        } catch (e) {
            console.error('Markdown parse error:', e);
            html = esc(processed).replace(/\n/g, '<br>');
        }
    } else {
        html = esc(processed).replace(/\n/g, '<br>');
    }

    // ---- 3. 用 template 元素承载（离线构建，不触发资源加载）----
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const container = tpl.content;

    // ---- 4. 还原 @ 提及占位符（在 sanitize 之前，作元素插入）----
    (function restoreMentions(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null);
        const comments = [];
        let node;
        while ((node = walker.nextNode())) {
            const m = /^MENTION_(\d+)$/.exec(node.nodeValue || '');
            if (m) comments.push({ comment: node, idx: parseInt(m[1], 10) });
        }
        comments.forEach(function (item) {
            const info = mentionPlaceholders[item.idx];
            if (!info) { item.comment.remove(); return; }
            const a = document.createElement('a');
            a.className = 'mention-link' + (info.silent ? ' mention-silent' : '');
            a.href = '/user/' + info.uid;
            const nick = (window.__MENTION_NAMES__ && window.__MENTION_NAMES__[info.uid])
                || ('user-' + info.uid);
            a.textContent = '@' + nick;
            item.comment.parentNode.replaceChild(a, item.comment);
        });
    })(container);

    // ---- 5. sanitize ----
    sanitize(container);

    // ---- 6. KaTeX auto-render（在 sanitize 后的 DOM 上，跳过 pre/code）----
    if (window.renderMathInElement) {
        try {
            renderMathInElement(container, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\(', right: '\\)', display: false },
                ],
                ignoredTags: ['script', 'noscript', 'style', 'textarea',
                              'pre', 'code', 'option'],
                ignoredClasses: ['no-katex', 'katex-ignore', 'md-editor-preview',
                                 'msg-content', 'md-editor-textarea'],
                throwOnError: false,
                trust: false,
            });
        } catch (e) {
            console.error('KaTeX render error:', e);
        }
    }

    // ---- 7. 代码块复制按钮（仅渲染节点，点击由文档级委托处理）----
    container.querySelectorAll('pre').forEach(function (pre) {
        if (pre.querySelector('.code-copy-btn')) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'code-copy-btn';
        btn.textContent = '复制';
        btn.title = '复制代码';
        pre.appendChild(btn);
    });

    // ---- 8. 用临时容器取 innerHTML（template 的 content 没有 innerHTML 属性）----
    const wrap = document.createElement('div');
    wrap.appendChild(container);
    return wrap.innerHTML;

    // URL 协议白名单。判定前必须先剥掉浏览器在解析 URL 时同样会忽略的
    // 控制字符与空白：href="java&#10;script:alert(1)" 在浏览器里就是活的
    // javascript: 协议，但 getAttribute 读回来是 "java\nscript:..."，
    // 直接用原串做 /^javascript:/ 匹配会被绕过。
    const DANGEROUS_SCHEME_RE = /^(?:javascript|data|vbscript):/i;
    const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction',
        'srcset', 'poster', 'data', 'background', 'cite'];

    function normalizeUrlForSchemeCheck(value) {
        // 剥掉控制字符、空白、BOM 与行分隔符（写成转义序列，源文件保持纯 ASCII）
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u0020\u00a0\u2028\u2029\ufeff]/g, '');
    }

    function sanitize(root) {
        root.querySelectorAll('script, iframe, object, embed, link, meta, style, base, form')
            .forEach(n => n.remove());
        root.querySelectorAll('*').forEach(el => {
            for (const attr of Array.from(el.attributes)) {
                const name = attr.name.toLowerCase();
                const value = String(attr.value || '');
                if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
                if (URL_ATTRS.indexOf(name) >= 0
                    && DANGEROUS_SCHEME_RE.test(normalizeUrlForSchemeCheck(value))) {
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
    const wrap = btn.closest('.msg-body')
              || btn.closest('.dm-msg')
              || btn.closest('.pinned-item')
              || btn.closest('.md-editor-footer');
    if (!wrap) return;
    const el = wrap.querySelector('.msg-content')
            || wrap.querySelector('.dm-bubble')
            || wrap.querySelector('.pinned-content')
            || wrap.querySelector('.md-editor-preview');
    if (!el) return;
    const raw = el.dataset.raw != null ? el.dataset.raw : el.textContent;
    if (el.dataset.mode === 'source') {
        const copyBtn = el.querySelector('.source-copy-btn');
        if (copyBtn) copyBtn.remove();
        el.innerHTML = window.renderContent
            ? window.renderContent(raw)
            // 兜底分支同样必须转义：raw 是消息正文（用户可控）
            : esc(raw).replace(/\n/g, '<br>');
        el.dataset.mode = 'render';
        btn.textContent = '📄';
        btn.title = '查看源码';
    } else {
        el.textContent = raw;
        el.dataset.mode = 'source';
        btn.textContent = '👁';
        btn.title = '查看渲染';
        let copyEl = el.querySelector('.source-copy-btn');
        if (!copyEl) {
            copyEl = document.createElement('button');
            copyEl.type = 'button';
            copyEl.className = 'source-copy-btn';
            copyEl.textContent = '复制';
            copyEl.title = '复制源码';
            copyEl.addEventListener('click', function () {
                window.copyToClipboard(raw, copyEl);
            });
            el.style.position = 'relative';
            el.appendChild(copyEl);
        }
    }
};
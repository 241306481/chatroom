window.MY_UID = window.__CURRENT_UID__ || '';
window.esc = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
window.escAttr = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
const DANGEROUS_SCHEME_RE = /^(?:javascript|data|vbscript):/i;
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction',
    'srcset', 'poster', 'data', 'background', 'cite', 'srcdoc'];
const BLOCKED_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style',
    'base', 'form', 'title', 'textarea', 'xmp', 'plaintext', 'noembed', 'noframes',
    'noscript', 'template'];
const BLOCKED_SELECTOR = BLOCKED_TAGS.join(',');
const INLINE_PARENTS = 'p, li, td, th, summary, h1, h2, h3, h4, h5, h6';
function normalizeUrlForSchemeCheck(value) {
    return String(value == null ? '' : value)
        .replace(/[\u0000-\u0020\u00a0\u2028\u2029\ufeff]/g, '');
}
function unsafeStyle(value) {
    const css = String(value == null ? '' : value).replace(/\/\*[\s\S]*?\*\//g, '');
    return /expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding|@import|position\s*:\s*(?:fixed|sticky)/i
        .test(css);
}
function escapeTagText(html) {
    return String(html == null ? '' : html)
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function markdownInline(src) {
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return escapeTagText(src);
    try {
        if (win.marked && typeof win.marked.parseInline === 'function') {
            return win.marked.parseInline(src);
        }
        if (win.LuoguMarkdown && typeof win.LuoguMarkdown.parse === 'function') {
            return win.LuoguMarkdown.parse(src);
        }
        if (win.marked && typeof win.marked.parse === 'function') {
            return win.marked.parse(src, { gfm: true, breaks: false });
        }
    } catch (e) {}
    return escapeTagText(src);
}
function renderBlockedNode(node) {
    const doc = node.ownerDocument;
    const win = typeof window !== 'undefined' ? window : null;
    if (!doc || !win) return null;
    const tags = [];
    const src = String(node.outerHTML || '').replace(
        /<(?:"[^"]*"|'[^']*'|[^'">])*>/g,
        tag => {
            tags.push(tag);
            return '\uE000' + (tags.length - 1) + '\uE001';
        });
    const inline = node.parentElement && typeof node.parentElement.closest === 'function'
        && node.parentElement.closest(INLINE_PARENTS);
    let html;
    if (inline) {
        html = markdownInline(src);
    } else if (win.LuoguMarkdown && typeof win.LuoguMarkdown.parse === 'function') {
        html = win.LuoguMarkdown.parse(src);
    } else if (win.marked && typeof win.marked.parse === 'function') {
        html = win.marked.parse(src, { gfm: true, breaks: false });
    } else {
        html = escapeTagText(src);
    }
    html = String(html).replace(/\uE000(\d+)\uE001/g,
        (all, i) => escapeTagText(tags[+i] || ''));
    const tpl = doc.createElement('template');
    tpl.innerHTML = html;
    return tpl.content;
}
function sanitize(root) {
    const blocked = Array.from(root.querySelectorAll(BLOCKED_SELECTOR));
    for (const node of blocked) {
        if (node.parentElement && typeof node.parentElement.closest === 'function'
            && node.parentElement.closest(BLOCKED_SELECTOR)) continue;
        const content = renderBlockedNode(node);
        if (content && typeof node.replaceWith === 'function') node.replaceWith(content);
        else if (typeof node.remove === 'function') node.remove();
    }
    root.querySelectorAll('*').forEach(el => {
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) { el.removeAttribute(attr.name); continue; }
            if (name === 'style' && unsafeStyle(attr.value)) {
                el.removeAttribute(attr.name);
                continue;
            }
            if (URL_ATTRS.indexOf(name) >= 0
                && DANGEROUS_SCHEME_RE.test(normalizeUrlForSchemeCheck(attr.value))) {
                el.removeAttribute(attr.name);
            }
        }
    });
}
const FILE_KINDS = {
    pdf: 'pdf',
    doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
    xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet',
};
const FILE_KIND_LABELS = { pdf: 'PDF', word: 'Word', sheet: '表格', file: '文件' };
const FILE_KIND_ICONS = { pdf: '📕', word: '📘', sheet: '📗', file: '📄' };
function fileExtension(value) {
    const text = String(value == null ? '' : value).split(/[?#]/)[0];
    const m = /\.([a-z0-9]{1,10})$/i.exec(text);
    return m ? m[1].toLowerCase() : '';
}
function fileKind(label, url) {
    const fromLabel = fileExtension(label);
    if (FILE_KINDS[fromLabel]) return FILE_KINDS[fromLabel];
    const fromUrl = fileExtension(String(url == null ? '' : url));
    return FILE_KINDS[fromUrl] || '';
}
function parsedFileUrl(raw) {
    try {
        return new URL(String(raw == null ? '' : raw), window.location.href);
    } catch (e) {
        return null;
    }
}
function safeFileUrl(raw, kind) {
    const parsed = parsedFileUrl(raw);
    if (!parsed) return false;
    if (parsed.origin === window.location.origin) return true;
    return parsed.protocol === 'https:' && kind === 'pdf';
}
function fileDownloadUrl(raw) {
    const parsed = parsedFileUrl(raw);
    if (!parsed || parsed.origin !== window.location.origin) return '';
    if (!/\/(?:file|files|myfile)\/[^/]+$/.test(parsed.pathname)) return '';
    return parsed.pathname.replace(/\/$/, '') + '/download' + parsed.search;
}
function fileNameFromUrl(raw) {
    const parsed = parsedFileUrl(raw);
    if (!parsed) return '文件';
    const part = parsed.pathname.split('/').filter(Boolean).pop() || '';
    try { return decodeURIComponent(part) || '文件'; } catch (e) { return part || '文件'; }
}
function fileCardLink(text, href, className) {
    const a = document.createElement('a');
    a.className = className;
    a.href = href;
    a.textContent = text;
    const parsed = parsedFileUrl(href);
    if (parsed && parsed.origin !== window.location.origin) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
    }
    return a;
}
function buildFileBody(card) {
    if (card.dataset.fileBody === '1') return;
    card.dataset.fileBody = '1';
    const body = card.querySelector('.md-file-body');
    if (!body) return;
    const kind = card.dataset.fileKind || 'file';
    if (kind === 'pdf') {
        const frame = document.createElement('iframe');
        frame.className = 'md-file-embed';
        frame.src = card.dataset.fileUrl;
        frame.title = card.dataset.fileLabel || 'PDF 预览';
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer';
        body.appendChild(frame);
        const hint = document.createElement('span');
        hint.className = 'md-file-preview-hint';
        hint.textContent = '若浏览器不支持内嵌预览，请点击“打开”查看。';
        body.appendChild(hint);
        return;
    }
    const note = document.createElement('span');
    note.className = 'md-file-preview-note';
    note.textContent = kind === 'word'
        ? 'Word 文档暂不支持在线预览，请打开或下载查看。'
        : kind === 'sheet'
            ? '表格文件暂不支持在线预览，请打开或下载查看。'
            : '此文件暂不支持在线预览，请打开或下载查看。';
    body.appendChild(note);
}
function makeFileCard(label, url, expanded) {
    const kind = fileKind(label, url) || 'file';
    const card = document.createElement('span');
    card.className = 'md-file-card md-file-' + kind
        + (expanded ? ' md-file-expanded' : '');
    card.dataset.fileKind = kind;
    card.dataset.fileUrl = url;
    card.dataset.fileLabel = label || fileNameFromUrl(url);
    const row = document.createElement('span');
    row.className = 'md-file-row';
    const icon = document.createElement('span');
    icon.className = 'md-file-icon';
    icon.textContent = FILE_KIND_ICONS[kind] || FILE_KIND_ICONS.file;
    const name = fileCardLink(card.dataset.fileLabel, url, 'md-file-name');
    const kindLabel = document.createElement('span');
    kindLabel.className = 'md-file-kind';
    kindLabel.textContent = FILE_KIND_LABELS[kind] || FILE_KIND_LABELS.file;
    const actions = document.createElement('span');
    actions.className = 'md-file-actions';
    actions.appendChild(fileCardLink('打开', url, 'md-file-action'));
    const download = fileDownloadUrl(url);
    if (download) {
        const dl = fileCardLink('下载', download, 'md-file-action');
        dl.setAttribute('download', '');
        actions.appendChild(dl);
    }
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'md-file-toggle';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.textContent = expanded ? '收起' : '展开';
    actions.appendChild(toggle);
    const body = document.createElement('span');
    body.className = 'md-file-body';
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(kindLabel);
    row.appendChild(actions);
    card.appendChild(row);
    card.appendChild(body);
    if (expanded) buildFileBody(card);
    return card;
}
function enhanceFileCards(root) {
    root.querySelectorAll('img').forEach(img => {
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        if (img.closest('code, pre')) return;
        const label = img.getAttribute('alt') || '';
        const src = img.getAttribute('src') || '';
        const kind = fileKind(label, src);
        if (!kind || !safeFileUrl(src, kind)) return;
        if (!img.parentNode) return;
        img.replaceWith(makeFileCard(label || fileNameFromUrl(src), src, true));
    });
    root.querySelectorAll('a[href]').forEach(a => {
        if (a.closest('code, pre')) return;
        const prev = a.previousSibling;
        if (!prev || prev.nodeType !== 3 || !/@$/.test(prev.nodeValue || '')) return;
        const label = a.textContent || '';
        const url = a.getAttribute('href') || '';
        const kind = fileKind(label, url) || 'file';
        if (!safeFileUrl(url, kind)) return;
        if (!a.parentNode) return;
        if (prev.nodeValue.length === 1) prev.remove();
        else prev.nodeValue = prev.nodeValue.slice(0, -1);
        a.replaceWith(makeFileCard(label || fileNameFromUrl(url), url, false));
    });
}
function scrollParentOf(el) {
    let parent = el.parentElement;
    while (parent) {
        const style = window.getComputedStyle(parent);
        if (/(auto|scroll)/.test(String(style.overflowY || ''))
            && parent.scrollHeight > parent.clientHeight) return parent;
        parent = parent.parentElement;
    }
    return null;
}
function toggleFileCard(btn) {
    const card = btn.closest('.md-file-card');
    if (!card) return;
    const scroller = scrollParentOf(card);
    const before = card.getBoundingClientRect().top;
    const expanded = card.classList.toggle('md-file-expanded');
    btn.textContent = expanded ? '收起' : '展开';
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (expanded) buildFileBody(card);
    const after = card.getBoundingClientRect().top;
    if (scroller) scroller.scrollTop += after - before;
    else if (window.scrollBy) window.scrollBy(0, after - before);
}
window.FileCards = {
    enhance: enhanceFileCards,
    ensureBody: buildFileBody,
    toggle: toggleFileCard,
};
window.copyToClipboard = function (text, btn) {
    navigator.clipboard.writeText(text).then(function () {
        if (!btn) return;
        if (btn.classList && btn.classList.contains('copy-button')) {
            btn.classList.add('copied');
            setTimeout(function () { btn.classList.remove('copied'); }, 1500);
            return;
        }
        const old = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = old; }, 1500);
    });
};
document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const toggle = t.closest('.md-file-toggle');
    if (toggle) {
        e.preventDefault();
        toggleFileCard(toggle);
        return;
    }
});
document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest('.code-copy-btn, .copy-button');
    if (!btn) return;
    const box = btn.closest('.code-container') || btn.closest('pre');
    if (!box) return;
    const code = box.querySelector('code');
    window.copyToClipboard(code ? code.textContent : box.textContent, btn);
});
window.renderContent = function (text) {
    if (text == null) return '';
    text = String(text);
    const mentionPlaceholders = [];
    const processed = text.replace(/@(@?)\[(\d+)\]/g,
        (whole, at, uid) => {
            const idx = mentionPlaceholders.length;
            mentionPlaceholders.push({ uid: uid, silent: at === '@' });
            return '<!--MENTION_' + idx + '-->';
        });
    let html;
    try {
        if (window.LuoguMarkdown) html = window.LuoguMarkdown.parse(processed);
        else if (typeof marked !== 'undefined') {
            html = marked.parse(processed, { breaks: false, gfm: true });
        } else html = esc(processed).replace(/\n/g, '<br>');
    } catch (e) {
        console.error('Markdown parse error:', e);
        html = esc(processed).replace(/\n/g, '<br>');
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const container = tpl.content;
    if (window.LuoguMarkdown) window.LuoguMarkdown.mergeTables(container);
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
    sanitize(container);
    enhanceFileCards(container);
    if (window.highlightCode) window.highlightCode(container);
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
    const copyIcon = '<svg viewBox="0 0 448 512" aria-hidden="true">'
        + '<path d="M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z"/>'
        + '</svg>';
    container.querySelectorAll('pre').forEach(function (pre) {
        if (pre.closest('.code-container')) return;
        const parent = pre.parentNode;
        if (!parent) return;
        const box = document.createElement('div');
        box.className = 'code-container';
        parent.insertBefore(box, pre);
        box.appendChild(pre);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'copy-button';
        btn.title = '复制代码';
        btn.setAttribute('aria-label', '复制代码');
        btn.innerHTML = copyIcon;
        box.appendChild(btn);
    });
    const wrap = document.createElement('div');
    wrap.appendChild(container);
    return wrap.innerHTML;
};
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

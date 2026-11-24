window.MY_UID = window.__CURRENT_UID__ || '';
window.userProfileUrl = function (uid) {
    const domain = window.__DOMAIN__ || '';
    const prefix = typeof window.__DOMAIN_PREFIX__ === 'string'
        ? window.__DOMAIN_PREFIX__
        : (domain ? '/domain/' + encodeURIComponent(domain) : '');
    return prefix + '/user/' + encodeURIComponent(uid);
};
window.esc = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
window.escAttr = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
window.formatTime = function (value, opts) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    const options = {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    };
    if (opts && opts.seconds) options.second = '2-digit';
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(d);
    const map = {};
    parts.forEach(function (p) {
        if (p.type !== 'literal') map[p.type] = p.value;
    });
    return map.year + '-' + map.month + '-' + map.day + ' '
        + map.hour + ':' + map.minute
        + (opts && opts.seconds ? ':' + map.second : '');
};
const DANGEROUS_SCHEME_RE = /^(?:javascript|data|vbscript):/i;
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction',
    'srcset', 'poster', 'data', 'background', 'cite', 'srcdoc'];
const BLOCKED_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style',
    'base', 'form', 'title', 'textarea', 'xmp', 'plaintext', 'noembed', 'noframes',
    'noscript', 'template'];
const BLOCKED_SELECTOR = BLOCKED_TAGS.join(',');
const INLINE_PARENTS = 'p, li, td, th, summary, h1, h2, h3, h4, h5, h6';
const INLINE_HTML_START_RE = /^<(?:a|abbr|audio|b|bdi|bdo|br|cite|code|data|del|dfn|em|i|img|input|ins|kbd|label|mark|meter|output|picture|progress|q|rp|rt|ruby|s|samp|small|source|span|strong|sub|sup|time|track|u|var|video|wbr)\b/i;
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
function safeFileUrl(raw) {
    const parsed = parsedFileUrl(raw);
    if (!parsed) return false;
    if (parsed.origin === window.location.origin) return true;
    return parsed.protocol === 'https:';
}
const FILE_VIEW_PATH_RE = /^\/(?:myfile\/[^/]+(?:\/[^/]+)?|messages\/file\/[^/]+\/[^/]+\/[^/]+|domain\/[^/]+\/files\/[^/]+|domain\/[^/]+\/discuss\/[^/]+\/file\/[^/]+)$/;
function fileThumbUrl(raw) {
    const parsed = parsedFileUrl(raw);
    if (!parsed || parsed.origin !== window.location.origin) return '';
    if (parsed.searchParams.get('thumb') === '1') return '';
    if (!FILE_VIEW_PATH_RE.test(parsed.pathname)) return '';
    const url = new URL(parsed.href);
    url.searchParams.set('thumb', '1');
    return url.href;
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
function makeFileCard(label, url, expanded, forcedKind) {
    const kind = forcedKind || fileKind(label, url) || 'file';
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
    root.querySelectorAll('.md-file-leaf').forEach(el => {
        const url = el.dataset.fileUrl || '';
        if (!safeFileUrl(url)) { el.remove(); return; }
        const kind = el.dataset.fileKind
            || fileKind(el.dataset.fileType, url) || '';
        const label = el.dataset.fileLabel || fileNameFromUrl(url);
        el.replaceWith(makeFileCard(label, url, el.dataset.fileOpen === '1', kind));
    });
    root.querySelectorAll('img').forEach(img => {
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        if (img.closest('code, pre')) return;
        const label = img.getAttribute('alt') || '';
        const src = img.getAttribute('src') || '';
        const thumb = fileThumbUrl(src);
        if (thumb) {
            if (!img.closest('a') && img.parentNode) {
                const link = document.createElement('a');
                link.href = src;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                img.parentNode.insertBefore(link, img);
                link.appendChild(img);
            }
            img.setAttribute('src', thumb);
            return;
        }
        const kind = fileKind(label, src);
        if (!kind || !safeFileUrl(src)) return;
        if (!img.parentNode) return;
        img.replaceWith(makeFileCard(label || fileNameFromUrl(src), src, true));
    });
    root.querySelectorAll('a[href]').forEach(a => {
        if (a.closest('code, pre')) return;
        const prev = a.previousSibling;
        if (!prev || prev.nodeType !== 3 || !/@$/.test(prev.nodeValue || '')) return;
        const label = a.textContent || '';
        const url = a.getAttribute('href') || '';
        if (!safeFileUrl(url)) return;
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
window.copyToClipboard = function (text, btn, okText) {
    const value = String(text == null ? '' : text);
    function feedback(ok) {
        if (!btn) return;
        if (btn.classList && btn.classList.contains('copy-button')) {
            btn.classList.remove('copied', 'copy-failed');
            btn.classList.add(ok ? 'copied' : 'copy-failed');
            if (btn._copyTimer != null) clearTimeout(btn._copyTimer);
            btn._copyTimer = setTimeout(function () {
                btn.classList.remove('copied', 'copy-failed');
                btn._copyTimer = null;
            }, 1500);
            return;
        }
        const old = btn._copyLabel != null ? btn._copyLabel : btn.textContent;
        btn._copyLabel = old;
        btn.textContent = ok ? (okText || '已复制') : '复制失败';
        if (btn._copyTimer != null) clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(function () {
            btn.textContent = old;
            btn._copyLabel = null;
            btn._copyTimer = null;
        }, 1500);
    }
    function fallback() {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-9999px';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        if (area.setSelectionRange) area.setSelectionRange(0, area.value.length);
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        area.remove();
        feedback(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            navigator.clipboard.writeText(value).then(function () {
                feedback(true);
            }, fallback);
            return;
        } catch (e) {}
    }
    fallback();
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
function unwrapInlineHtmlParagraph(container, source) {
    const first = container.firstElementChild;
    if (!first || first !== container.lastElementChild) return;
    if (first.tagName !== 'P') return;
    const raw = String(source == null ? '' : source).trim();
    if (!INLINE_HTML_START_RE.test(raw)) return;
    if (/\n\s*\n/.test(raw)) return;
    const parent = first.parentNode;
    while (first.firstChild) parent.insertBefore(first.firstChild, first);
    parent.removeChild(first);
}
const INLINE_TEXT_TAGS = new Set([
    'A', 'IMG', 'STRONG', 'EM', 'DEL', 'CODE', 'BR',
]);
function unwrapElementOnlyParagraphs(container) {
    container.querySelectorAll('p').forEach(function (p) {
        const children = Array.from(p.childNodes).filter(function (node) {
            return !(node.nodeType === 3 && !node.nodeValue.trim());
        });
        if (!children.length) return;
        if (!children.every(function (node) { return node.nodeType === 1; })) return;
        if (children.some(function (node) { return INLINE_TEXT_TAGS.has(node.tagName); })) {
            return;
        }
        const parent = p.parentNode;
        children.forEach(function (node) { parent.insertBefore(node, p); });
        parent.removeChild(p);
    });
}
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
    unwrapInlineHtmlParagraph(container, processed);
    unwrapElementOnlyParagraphs(container);
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
            a.href = window.userProfileUrl(info.uid);
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
    const copyIcon = '<svg class="copy-icon" viewBox="0 0 448 512" aria-hidden="true">'
        + '<path d="M192 0c-35.3 0-64 28.7-64 64l0 256c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-200.6c0-17.4-7.1-34.1-19.7-46.2L370.6 17.8C358.7 6.4 342.8 0 326.3 0L192 0zM64 128c-35.3 0-64 28.7-64 64L0 448c0 35.3 28.7 64 64 64l192 0c35.3 0 64-28.7 64-64l0-16-64 0 0 16-192 0 0-256 16 0 0-64-16 0z"/>'
        + '</svg>';
    const checkIcon = '<svg class="copy-check" viewBox="0 0 24 24" aria-hidden="true">'
        + '<circle class="copy-check-bg" cx="12" cy="12" r="11"/>'
        + '<path class="copy-check-mark" d="M6.8 12.4l3.4 3.4 7-7.2"/>'
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
        btn.innerHTML = copyIcon + checkIcon;
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
        delete el.dataset.forwardRendered;
        if (window.ChatForwardCard) window.ChatForwardCard.enhance(el);
        btn.textContent = '📄';
        btn.title = '查看源码';
        btn.setAttribute('aria-label', btn.title);
    } else {
        el.textContent = raw;
        el.dataset.mode = 'source';
        btn.textContent = '👁️';
        btn.title = '查看渲染';
        btn.setAttribute('aria-label', btn.title);
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
    const msg = btn.closest('.message, .dm-msg');
    if (msg && window.CollapseUI) window.CollapseUI.refreshMessage(msg);
    const pin = btn.closest('.pinned-item');
    if (pin && window.CollapseUI) window.CollapseUI.refreshPinned(pin);
};
document.addEventListener('click', function (e) {
    const el = e.target && e.target.closest
        ? e.target.closest('[data-action]') : null;
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    switch (action) {
    case 'inline-edit-id':
        e.preventDefault();
        e.stopPropagation();
        if (window.inlineEditId) window.inlineEditId(el);
        break;
    case 'inline-edit-title':
        e.preventDefault();
        e.stopPropagation();
        if (window.inlineEditTitle) window.inlineEditTitle(el);
        break;
    case 'inline-edit-filename':
        if (window.inlineEditFilename) window.inlineEditFilename(el);
        break;
    case 'delete-discussion':
        if (window.deleteListItem) window.deleteListItem(el);
        break;
    case 'toggle-file-visibility':
        if (window.toggleFileVisibility) {
            window.toggleFileVisibility(el, el.dataset.actionUrl || '');
        }
        break;
    case 'upload-file': {
        const input = document.getElementById(el.dataset.fileInput || 'fileInput');
        if (input) input.click();
        break;
    }
    case 'edit-message':
        if (el.closest('.dm-msg') && window.editDMMessage) {
            window.editDMMessage(id, el);
        } else if (window.editMessage) {
            window.editMessage(id, el);
        }
        break;
    case 'copy-message-link':
        if (window.copyMessageLink) window.copyMessageLink(id, el);
        break;
    case 'show-message-history':
        if (window.showMessageHistory) window.showMessageHistory(id, el);
        break;
    case 'toggle-message-collapse':
        e.preventDefault();
        e.stopPropagation();
        if (window.toggleMessageCollapse) window.toggleMessageCollapse(el);
        break;
    case 'toggle-pinned-collapse':
        e.preventDefault();
        e.stopPropagation();
        if (window.togglePinnedCollapse) window.togglePinnedCollapse(el);
        break;
    case 'forward-message':
        if (window.forwardMessage) window.forwardMessage(id, el);
        break;
    case 'toggle-source':
        if (window.toggleSource) window.toggleSource(el);
        break;
    case 'set-reply-to':
        if (window.setReplyTo) window.setReplyTo(id, el);
        break;
    case 'clear-reply':
        if (window.clearReplyTo) window.clearReplyTo();
        break;
    case 'toggle-reaction-picker':
        if (window.toggleReactionPicker) window.toggleReactionPicker(id, el);
        break;
    case 'pin-message':
        if (window.pinMessage) window.pinMessage(id);
        break;
    case 'unpin-message':
        if (window.unpinMessage) window.unpinMessage(id);
        break;
    case 'revoke-message':
        if (window.revokeMessage) window.revokeMessage(id);
        break;
    case 'delete-message':
        if (window.deleteMessage) window.deleteMessage(id);
        break;
    case 'scroll-to-message':
        e.preventDefault();
        if (window.scrollToMessage) window.scrollToMessage(id);
        break;
    case 'batch-pin':
        if (window.batchPinSelected) {
            window.batchPinSelected(el.dataset.pinned === 'true');
        }
        break;
    case 'batch-delete':
        if (window.batchDeleteSelected) window.batchDeleteSelected();
        break;
    case 'batch-cancel':
        if (window.toggleMessageBatch) window.toggleMessageBatch(false);
        break;
    case 'batch-forward-merge':
        if (window.batchForwardSelected) window.batchForwardSelected('merge');
        break;
    case 'batch-forward-split':
        if (window.batchForwardSelected) window.batchForwardSelected('split');
        break;
    case 'mute-member':
        if (window.muteMember) window.muteMember(el.dataset.uid);
        break;
    case 'unmute-member':
        if (window.unmuteMember) window.unmuteMember(el.dataset.uid);
        break;
    case 'new-dm-target':
        if (window.newDMTarget) window.newDMTarget();
        break;
    case 'send-message':
        if (window.sendMessage) window.sendMessage();
        break;
    case 'send-dm':
        if (window.sendDM) window.sendDM();
        break;
    default:
        break;
    }
});
document.addEventListener('change', function (e) {
    const el = e.target;
    if (!el || !el.matches || !el.matches('[data-auto-submit]')) return;
    if (el.form) el.form.requestSubmit();
});
function unlockForm(form) {
    form.querySelectorAll('button[type="submit"]').forEach(function (b) {
        b.disabled = false;
    });
}
function showFormError(message) {
    if (window.showAlert) window.showAlert(message);
    else window.alert(message);
}
const VIEW_STATE_KEY = 'chatroom:view-restore';
const VIEW_STATE_TTL = 15000;
const VIEW_SCROLL_TARGETS = [
    '#messageList', '.dm-list', '.members-panel', '.pinned-panel',
];
function captureViewState() {
    const items = [];
    VIEW_SCROLL_TARGETS.forEach(function (selector) {
        const el = document.querySelector(selector);
        if (el) {
            items.push({
                selector: selector,
                top: el.scrollTop,
                left: el.scrollLeft,
            });
        }
    });
    return {
        path: location.pathname + location.search,
        at: Date.now(),
        x: window.scrollX,
        y: window.scrollY,
        items: items,
    };
}
function saveViewState() {
    try {
        sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(captureViewState()));
    } catch (e) {}
}
function clearViewState() {
    try { sessionStorage.removeItem(VIEW_STATE_KEY); } catch (e) {}
}
function applyViewState(snap) {
    window.scrollTo(snap.x || 0, snap.y || 0);
    (snap.items || []).forEach(function (item) {
        const el = document.querySelector(item.selector);
        if (!el) return;
        el.scrollTop = item.top;
        el.scrollLeft = item.left;
    });
}
function restoreViewState() {
    let raw = null;
    try { raw = sessionStorage.getItem(VIEW_STATE_KEY); } catch (e) { return; }
    if (!raw) return;
    clearViewState();
    let snap;
    try { snap = JSON.parse(raw); } catch (e) { return; }
    if (!snap || snap.path !== location.pathname + location.search) return;
    if (location.hash || Date.now() - snap.at > VIEW_STATE_TTL) return;
    function schedule() {
        requestAnimationFrame(function () { applyViewState(snap); });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', schedule, { once: true });
    } else {
        schedule();
    }
}
restoreViewState();
const SOFT_PATH_PATTERNS = [
    /^\/manage(?:\/|$)/,
    /^\/users$/,
    /^\/domain\/[^/]+\/manage(?:\/|$)/,
    /^\/domain\/[^/]+\/users$/,
];
function isSoftNavigation(url) {
    let target;
    try { target = new URL(url, location.href); } catch (e) { return false; }
    if (target.origin !== location.origin || target.hash) return false;
    if (target.pathname + target.search !== location.pathname + location.search) return false;
    return SOFT_PATH_PATTERNS.some(function (re) { return re.test(target.pathname); });
}
function currentNonce() {
    const script = document.querySelector('script[nonce]');
    return script ? (script.nonce || script.getAttribute('nonce') || '') : '';
}
function runScripts(root) {
    const nonce = currentNonce();
    Array.from(root.querySelectorAll('script')).forEach(function (old) {
        const script = document.createElement('script');
        Array.from(old.attributes).forEach(function (attr) {
            if (attr.name.toLowerCase() === 'nonce') return;
            script.setAttribute(attr.name, attr.value);
        });
        if (nonce) script.nonce = nonce;
        script.textContent = old.textContent;
        old.replaceWith(script);
    });
}
function softSwap(doc) {
    const main = document.querySelector('main.app-main');
    const nextMain = doc.querySelector('main.app-main');
    if (!main || !nextMain) return false;
    const snap = captureViewState();
    const filter = document.querySelector('.list-filter-input');
    const filterValue = filter ? filter.value : '';
    main.innerHTML = nextMain.innerHTML;
    runScripts(main);
    if (doc.title) document.title = doc.title;
    if (filterValue) {
        const nextFilter = main.querySelector('.list-filter-input');
        if (nextFilter) nextFilter.value = filterValue;
    }
    applyViewState(snap);
    requestAnimationFrame(function () { applyViewState(snap); });
    document.dispatchEvent(new CustomEvent('app:content'));
    return true;
}
function softApplyHtml(html, fallbackUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc.querySelector('main.app-main')) {
        saveViewState();
        location.href = fallbackUrl;
        return false;
    }
    const apply = function () { softSwap(doc); };
    if (document.startViewTransition) document.startViewTransition(apply);
    else apply();
    return true;
}
function softNavigate(url, message) {
    const target = new URL(url, location.href);
    const key = target.pathname + target.search;
    return fetch(target.href, {
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
        cache: 'no-store',
    }).then(function (res) {
        const finalUrl = new URL(res.url || target.href);
        if (finalUrl.pathname + finalUrl.search !== key) {
            saveViewState();
            location.href = finalUrl.href;
            return null;
        }
        if (!res.ok) {
            saveViewState();
            location.href = target.href;
            return null;
        }
        return res.text();
    }).then(function (html) {
        if (html == null) return;
        if (softApplyHtml(html, target.href) && message && window.showToast) {
            window.showToast(message);
        }
    }).catch(function () {
        saveViewState();
        location.href = target.href;
    });
}
function softSubmitNative(form, submitter) {
    if (form.dataset.softSubmitting === '1') return;
    let hasFiles = false;
    form.querySelectorAll('input[type="file"]').forEach(function (input) {
        if (input.files && input.files.length) hasFiles = true;
    });
    if (hasFiles) {
        HTMLFormElement.prototype.submit.call(form);
        return;
    }
    const actionAttr = submitter && submitter.hasAttribute
        && submitter.hasAttribute('formaction')
        ? submitter.getAttribute('formaction')
        : form.getAttribute('action');
    const action = actionAttr ? new URL(actionAttr, location.href).href : location.href;
    const body = new URLSearchParams(new FormData(form, submitter));
    form.dataset.softSubmitting = '1';
    form.querySelectorAll('button[type="submit"]').forEach(function (btn) {
        btn.disabled = true;
    });
    fetch(action, {
        method: 'POST',
        body: body,
        credentials: 'same-origin',
        headers: { Accept: 'text/html' },
    }).then(function (res) {
        const finalUrl = new URL(res.url || action);
        const samePage = finalUrl.pathname + finalUrl.search
            === location.pathname + location.search;
        if (!samePage) {
            saveViewState();
            location.href = finalUrl.href;
            return null;
        }
        if (!res.ok) {
            saveViewState();
            location.reload();
            return null;
        }
        return res.text();
    }).then(function (html) {
        if (html != null) softApplyHtml(html, action);
    }).catch(function () {
        showFormError('网络错误，请稍后重试');
    }).then(function () {
        delete form.dataset.softSubmitting;
        unlockForm(form);
    });
}
function saveDownload(res) {
    const cd = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/.exec(cd);
    return res.blob().then(function (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = match ? match[1] : 'download';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
}
function handleJsonResponse(res) {
    return res.text().then(function (text) {
        let data;
        try { data = JSON.parse(text); }
        catch (e) { throw new Error('服务器返回无效响应'); }
        if (res.status === 401) {
            location.href = '/login?return_to='
                + encodeURIComponent(location.pathname + location.search);
            return;
        }
        if (!data.ok) {
            showFormError(data.error || '操作失败');
            return;
        }
        if (data.redirect && isSoftNavigation(data.redirect)) {
            return softNavigate(data.redirect, data.message);
        }
        if (data.redirect) saveViewState();
        location.href = data.redirect || location.href;
    });
}
document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || !form.getAttribute) return;
    const name = form.getAttribute('data-submit-action');
    if (!name) return;
    const fn = window[name];
    if (typeof fn === 'function' && fn(form) === false) e.preventDefault();
});
document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || !form.getAttribute || e.defaultPrevented) return;
    if ((form.getAttribute('method') || '').toUpperCase() !== 'POST') return;
    if (form.hasAttribute('data-native')) return;
    if (form.getAttribute('target')) return;
    if (form.dataset.submitting === '1') {
        e.preventDefault();
        return;
    }
    const submitter = e.submitter;
    const overrideAction = submitter && submitter.hasAttribute
        && submitter.hasAttribute('formaction');
    const actionAttr = overrideAction
        ? submitter.getAttribute('formaction')
        : form.getAttribute('action');
    const action = actionAttr
        ? new URL(actionAttr, location.href).href
        : location.href;
    const isDownload = !!submitter && submitter.dataset.batchAction === 'download';
    let hasFiles = false;
    form.querySelectorAll('input[type="file"]').forEach(function (input) {
        if (input.files && input.files.length) hasFiles = true;
    });
    const data = new FormData(form, submitter);
    const body = hasFiles ? data : new URLSearchParams(data);
    e.preventDefault();
    form.dataset.submitting = '1';
    fetch(action, {
        method: 'POST',
        body: body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
    }).then(function (res) {
        const ct = res.headers.get('Content-Type') || '';
        if (isDownload && ct.indexOf('application/json') < 0) {
            if (!res.ok) throw new Error('下载失败');
            return saveDownload(res);
        }
        return handleJsonResponse(res);
    }).catch(function (err) {
        showFormError(err && err.message ? err.message : '网络错误，请稍后重试');
    }).then(function () {
        delete form.dataset.submitting;
        unlockForm(form);
    });
});
document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    const form = e.target;
    if (!form || !form.getAttribute) return;
    if ((form.getAttribute('method') || '').toUpperCase() !== 'POST') return;
    const target = form.getAttribute('target');
    if (target && target !== '_self') return;
    if (!form.hasAttribute('data-native') && !target) return;
    const submitter = e.submitter;
    if (submitter && submitter.dataset && submitter.dataset.batchAction === 'download') return;
    if (isSoftNavigation(location.href)) {
        e.preventDefault();
        softSubmitNative(form, submitter);
        return;
    }
    saveViewState();
});

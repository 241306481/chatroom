(function (root) {
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const OPEN_RE = /^ {0,3}(:{3,})([A-Za-z][\w-]*)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/;
    const LEAF_RE = /^ {0,3}::(cute-table)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/;
    const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
    const TABLE_START_RE = /\|/;
    const TABLE_ALIGN_RE = /^\s*\|?\s*:?-{3,}/;
    const CALLOUTS = {
        info: { title: '提示' },
        success: { title: '成功' },
        warning: { title: '警告' },
        error: { title: '错误' },
    };
    function fenceAt(line) {
        const m = FENCE_RE.exec(line);
        return m ? { ch: m[1][0], len: m[1].length } : null;
    }
    function fenceClosed(line, fence) {
        const m = FENCE_RE.exec(line);
        if (!m || m[1][0] !== fence.ch || m[1].length < fence.len) return false;
        return new RegExp('^ {0,3}' + (fence.ch === '`' ? '`' : '~')
            + '{' + fence.len + ',}\\s*$').test(line);
    }
    function rawTagAt(line) {
        const m = /^ {0,3}<(pre|code|script|style|textarea|xmp|plaintext)\b/i.exec(line);
        if (!m) return null;
        return new RegExp('</' + m[1] + '>', 'i').test(line) ? null : m[1].toLowerCase();
    }
    function rawTagClosed(line, tag) {
        return new RegExp('</' + tag + '>', 'i').test(line);
    }
    function closeAfterFence(lines, start, fence, closeRe) {
        let closed = false;
        for (let i = start; i < lines.length; i++) {
            if (!closed) {
                if (fenceClosed(lines[i], fence)) closed = true;
                continue;
            }
            if (closeRe.test(lines[i])) return true;
        }
        return false;
    }
    function findClose(lines, start, count) {
        const closeRe = new RegExp('^ {0,3}:{' + count + '}\\s*$');
        let fence = null;
        let raw = null;
        for (let i = start; i < lines.length; i++) {
            const line = lines[i];
            if (fence) {
                if (fenceClosed(line, fence)) {
                    fence = null;
                } else if (closeRe.test(line)
                    && !closeAfterFence(lines, i + 1, fence, closeRe)) {
                    return i;
                }
                continue;
            }
            if (raw) {
                if (rawTagClosed(line, raw)) raw = null;
                continue;
            }
            const r = rawTagAt(line);
            if (r) { raw = r; continue; }
            const f = fenceAt(line);
            if (f) { fence = f; continue; }
            if (closeRe.test(line)) return i;
        }
        return -1;
    }
    function inline(src) {
        if (!root.marked || typeof root.marked.parseInline !== 'function') return esc(src);
        return root.marked.parseInline(String(src == null ? '' : src));
    }
    function attr(s) {
        return esc(s).replace(/"/g, '&quot;');
    }
    function parseMarkdown(md) {
        const opts = { gfm: true, breaks: false };
        if (root.marked && typeof root.marked.Renderer === 'function') {
            const renderer = new root.marked.Renderer();
            const baseCode = renderer.code;
            renderer.code = function (code, infostring, escaped) {
                const parts = String(infostring == null ? '' : infostring).trim().split(/\s+/).filter(Boolean);
                let lang = (parts.shift() || '').toLowerCase();
                const options = parts.join(' ');
                if (!lang) lang = 'cpp';
                const out = baseCode.call(this, code, lang, escaped);
                const preAttrs = ' class="pre language-' + attr(lang) + '" data-lang="' + attr(lang) + '"'
                    + (options ? ' data-code-options="' + attr(options) + '"' : '') + ' tabindex="0"';
                return out.replace('<pre>', '<pre' + preAttrs + '>');
            };
            const baseListItem = renderer.listitem;
            if (typeof baseListItem === 'function') {
                renderer.listitem = function (text, task, checked) {
                    const out = baseListItem.call(this, text, task, checked);
                    return task ? out.replace(/^<li>/, '<li class="task-list-item">') : out;
                };
            }
            opts.renderer = renderer;
        }
        return root.marked.parse(md, opts);
    }
    function fragment(src, blocks, token) {
        const md = preprocess(src, blocks, token);
        if (!root.marked || typeof root.marked.parse !== 'function') {
            return esc(md).replace(/\n/g, '<br>');
        }
        return parseMarkdown(md);
    }
    function addBlock(blocks, token, html) {
        blocks.push(html);
        return '\n\n<!--' + token + '_' + (blocks.length - 1) + '-->\n\n';
    }
    function applyAlign(html, dir) {
        return html.replace(/<(p|h[1-6])(\s[^>]*)?>/gi, function (tag, name, attrs) {
            attrs = attrs || '';
            if (/\btext-align\s*:/i.test(attrs)) return tag;
            if (/\bstyle\s*=/i.test(attrs)) {
                return '<' + name + attrs.replace(
                    /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i,
                    function (all, quote, value) {
                        const clean = value.trim().replace(/;+$/, '');
                        return 'style=' + quote + (clean ? clean + '; ' : '')
                            + 'text-align: ' + dir + ';' + quote;
                    }) + '>';
            }
            return '<' + name + attrs + ' style="text-align: ' + dir + ';">';
        });
    }
    function addBoldColumn(html, column) {
        if (!column) return html;
        return html.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, function (row) {
            let index = 0;
            return row.replace(/<(th|td)\b([^>]*)>/gi, function (tag, name, attrs) {
                index += 1;
                if (index !== column) return tag;
                if (/\bclass\s*=/i.test(attrs)) {
                    return '<' + name + attrs.replace(
                        /\bclass\s*=\s*(["'])(.*?)\1/i,
                        function (all, quote, value) {
                            return 'class="' + value + ' cute-table-bold-col"';
                        }) + '>';
                }
                return '<' + name + attrs + ' class="cute-table-bold-col">';
            });
        });
    }
    function renderCuteTable(attrs, tableSrc) {
        const value = String(attrs || '').trim().toLowerCase();
        let cls = 'cute-table';
        let boldColumn = 0;
        if (value === 'three') {
            cls += ' cute-table-three';
        } else if (value === 'tuack') {
            cls += ' cute-table-tuack';
        } else {
            const m = /^tuack\s*=\s*(\d+)$/.exec(value);
            if (!m) return null;
            cls += ' cute-table-tuack';
            boldColumn = parseInt(m[1], 10);
        }
        const html = parseMarkdown(tableSrc);
        return '<div class="' + cls + '">' + addBoldColumn(html, boldColumn) + '</div>';
    }
    function renderContainer(name, label, attrs, inner, blocks, token) {
        const body = fragment(inner, blocks, token);
        const key = name.toLowerCase();
        const callout = CALLOUTS[key];
        if (callout) {
            const open = /(?:^|\s)open(?:\s|$)/i.test(attrs || '');
            const title = label != null && label.trim() !== '' ? label : callout.title;
            return '<details class="' + key + '"' + (open ? ' open' : '') + '>'
                + '<summary>' + inline(title) + '</summary>' + body + '</details>';
        }
        if (key === 'align') {
            const value = String(attrs || '').trim().toLowerCase();
            const dir = ['left', 'center', 'right'].indexOf(value) >= 0 ? value : 'center';
            return applyAlign(body, dir);
        }
        if (key === 'epigraph') {
            const hasSource = label != null && label.trim() !== '';
            return '<div class="epigraph' + (hasSource ? ' has-source' : '') + '">'
                + body + (hasSource ? '<p>' + inline(label) + '</p>' : '') + '</div>';
        }
        const cls = key.replace(/[^a-z0-9_-]/g, '-');
        const title = label != null && label.trim() !== ''
            ? '<div class="md-container-title">' + inline(label) + '</div>' : '';
        return '<section class="md-container md-container-' + cls + '">'
            + title + body + '</section>';
    }
    function preprocess(src, blocks, token) {
        const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let fence = null;
        let raw = null;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (fence) {
                out.push(line);
                if (fenceClosed(line, fence)) fence = null;
                continue;
            }
            if (raw) {
                out.push(line);
                if (rawTagClosed(line, raw)) raw = null;
                continue;
            }
            const r = rawTagAt(line);
            if (r) {
                raw = r;
                out.push(line);
                continue;
            }
            const f = fenceAt(line);
            if (f) {
                fence = f;
                out.push(line);
                continue;
            }
            const leaf = LEAF_RE.exec(line);
            if (leaf) {
                let start = i + 1;
                while (start < lines.length && lines[start].trim() === '') start++;
                if (start + 1 < lines.length && TABLE_START_RE.test(lines[start])
                    && TABLE_ALIGN_RE.test(lines[start + 1])) {
                    let end = start;
                    while (end < lines.length && lines[end].trim() !== ''
                        && lines[end].indexOf('|') >= 0) end++;
                    const html = renderCuteTable(leaf[3],
                        lines.slice(start, end).join('\n'));
                    if (html) {
                        out.push(addBlock(blocks, token, html));
                        i = end - 1;
                        continue;
                    }
                }
                out.push(line);
                continue;
            }
            const m = OPEN_RE.exec(line);
            if (!m) {
                out.push(line);
                continue;
            }
            const end = findClose(lines, i + 1, m[1].length);
            if (end < 0) {
                out.push(line);
                continue;
            }
            const inner = lines.slice(i + 1, end).join('\n');
            out.push(addBlock(blocks, token,
                renderContainer(m[2], m[3], m[4], inner, blocks, token)));
            i = end;
        }
        return out.join('\n');
    }
    function parse(src) {
        const text = String(src == null ? '' : src);
        if (!root.marked || typeof root.marked.parse !== 'function') {
            return esc(text).replace(/\n/g, '<br>');
        }
        const token = 'MDD' + Math.random().toString(36).slice(2, 10).toUpperCase();
        const blocks = [];
        const md = preprocess(text, blocks, token);
        let html = parseMarkdown(md);
        let prev;
        do {
            prev = html;
            const re = new RegExp('<!--' + token + '_(\\d+)-->', 'g');
            html = html.replace(re, (all, i) => blocks[+i] || '');
        } while (html !== prev);
        return html;
    }
    function mergeTable(table) {
        const rows = Array.from(table.rows || []);
        if (!rows.length) return;
        const occ = rows.map(() => []);
        const meta = new Map();
        function textOf(cell) {
            return String(cell.textContent == null ? '' : cell.textContent).trim();
        }
        function spanOf(cell, key) {
            return Number(cell[key]) || 1;
        }
        function occupy(cell, r0, c0, rs, cs) {
            for (let r = r0; r < r0 + rs && r < occ.length; r++) {
                if (!occ[r]) occ[r] = [];
                for (let c = c0; c < c0 + cs; c++) occ[r][c] = cell;
            }
            meta.set(cell, { r: r0, c: c0, rowSpan: rs, colSpan: cs });
        }
        function removeCell(cell) {
            meta.delete(cell);
            if (cell.remove) cell.remove();
        }
        function planExpand(target, info, rs, cs, ignore) {
            const covered = [];
            for (let r = info.r; r < info.r + rs && r < occ.length; r++) {
                for (let c = info.c; c < info.c + cs; c++) {
                    const hit = occ[r] && occ[r][c];
                    if (!hit || hit === target || hit === ignore) continue;
                    const hi = meta.get(hit);
                    const inside = hi && hi.r >= info.r && hi.c >= info.c
                        && hi.r + hi.rowSpan <= info.r + rs
                        && hi.c + hi.colSpan <= info.c + cs;
                    if (!inside || textOf(hit) !== '') return null;
                    if (covered.indexOf(hit) < 0) covered.push(hit);
                }
            }
            return covered;
        }
        function mergeMarker(cell, r, c, marker) {
            let target = null;
            if (marker === '<' && c > 0) {
                if (occ[r][c]) return false;
                target = occ[r][c - 1];
            } else if (marker === '^' && r > 0
                && (!rows[r - 1] || !rows[r].parentElement
                    || rows[r - 1].parentElement === rows[r].parentElement)) {
                target = occ[r - 1] && occ[r - 1][c];
                if (occ[r][c] && occ[r][c] !== target) target = null;
            }
            const info = target && meta.get(target);
            if (!info) return false;
            const rs = info.rowSpan + (marker === '^' ? 1 : 0);
            const cs = info.colSpan + (marker === '<' ? 1 : 0);
            const covered = planExpand(target, info, rs, cs, cell);
            if (!covered) return false;
            covered.forEach(removeCell);
            occupy(target, info.r, info.c, rs, cs);
            target.rowSpan = rs;
            target.colSpan = cs;
            removeCell(cell);
            return true;
        }
        for (let r = 0; r < rows.length; r++) {
            const cells = Array.from(rows[r].cells || []);
            let c = 0;
            for (const cell of cells) {
                const rs = spanOf(cell, 'rowSpan');
                const cs = spanOf(cell, 'colSpan');
                const text = textOf(cell);
                const plain = !cell.children || cell.children.length === 0;
                if (plain && (text === '<' || text === '^')
                    && mergeMarker(cell, r, c, text)) {
                    c += cs;
                    continue;
                }
                if (occ[r][c]) {
                    removeCell(cell);
                } else {
                    occupy(cell, r, c, rs, cs);
                }
                c += cs;
            }
        }
    }
    function mergeTables(container) {
        if (!container || typeof container.querySelectorAll !== 'function') return;
        container.querySelectorAll('table').forEach(mergeTable);
    }
    root.LuoguMarkdown = { parse, preprocess: preprocess, mergeTable, mergeTables };
})(typeof window !== 'undefined' ? window : globalThis);

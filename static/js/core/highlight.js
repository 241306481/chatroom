(function () {
    const C = 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false nullptr';
    const CPP = C + ' alignas alignof and and_eq asm bitand bitor catch class compl concept consteval constexpr constinit const_cast co_await co_return co_yield decltype delete dynamic_cast explicit export final friend mutable namespace new noexcept not not_eq operator or or_eq override private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw try typeid typename using virtual wchar_t xor xor_eq';
    const PY = 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case';
    const JS = 'async await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield of from get set true false null undefined';
    const TS = JS + ' interface type enum implements private public protected readonly declare abstract namespace keyof infer is as satisfies';
    const JAVA = 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record sealed permits';
    const GO = 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota';
    const RUST = 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while yield Some None Ok Err';
    const PHP = 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null';
    const RB = 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield';
    const SQL = 'add all alter and any as asc between by case check column commit constraint create database default delete desc distinct drop else end exists foreign from group having in index inner insert into is join key left like limit not null offset on or order outer primary references right rollback select set table then union unique update values view when where';
    const SH = 'if then else elif fi for while until do done case esac function in select time coproc true false local export readonly declare unset shift return exit break continue source echo printf cd pwd read test';
    const YAML = 'true false null yes no on off';
    const C_LIKE = { keywords: CPP, slash: true, block: true, preproc: true, single: true };
    const LANG = {
        c: { keywords: C, slash: true, block: true, preproc: true, single: true },
        cpp: C_LIKE,
        'c++': C_LIKE,
        cc: C_LIKE,
        cxx: C_LIKE,
        h: C_LIKE,
        hpp: C_LIKE,
        objc: C_LIKE,
        cs: { keywords: JAVA + ' string decimal object', slash: true, block: true, single: true },
        'c#': { keywords: JAVA + ' string decimal object', slash: true, block: true, single: true },
        java: { keywords: JAVA, slash: true, block: true, single: true },
        kotlin: { keywords: JAVA + ' fun val', slash: true, block: true, single: true },
        go: { keywords: GO, slash: true, block: true, single: true, backtick: true },
        rust: { keywords: RUST, slash: true, block: true, single: true },
        php: { keywords: PHP, slash: true, block: true, hash: true, single: true },
        swift: { keywords: JAVA + ' func let guard defer', slash: true, block: true, single: true },
        python: { keywords: PY, hash: true, single: true, triple: true },
        py: { keywords: PY, hash: true, single: true, triple: true },
        ruby: { keywords: RB, hash: true, single: true },
        rb: { keywords: RB, hash: true, single: true },
        js: { keywords: JS, slash: true, block: true, single: true, backtick: true },
        javascript: { keywords: JS, slash: true, block: true, single: true, backtick: true },
        jsx: { keywords: JS, slash: true, block: true, single: true, backtick: true, htmlTag: true },
        ts: { keywords: TS, slash: true, block: true, single: true, backtick: true },
        typescript: { keywords: TS, slash: true, block: true, single: true, backtick: true },
        tsx: { keywords: TS, slash: true, block: true, single: true, backtick: true, htmlTag: true },
        json: { keywords: '', single: false },
        jsonc: { keywords: '', slash: true, block: true, single: false },
        sql: { keywords: SQL, dash: true, block: true, single: true },
        bash: { keywords: SH, hash: true, single: true, backtick: true },
        sh: { keywords: SH, hash: true, single: true, backtick: true },
        shell: { keywords: SH, hash: true, single: true, backtick: true },
        zsh: { keywords: SH, hash: true, single: true, backtick: true },
        dockerfile: { keywords: SH, hash: true, single: true, backtick: true },
        makefile: { keywords: SH, hash: true, single: true, backtick: true },
        yaml: { keywords: YAML, hash: true, single: true },
        yml: { keywords: YAML, hash: true, single: true },
        toml: { keywords: YAML, hash: true, single: true },
        ini: { keywords: YAML, hash: true, single: true },
        html: { keywords: '', htmlComment: true, htmlTag: true, single: true },
        xml: { keywords: '', htmlComment: true, htmlTag: true, single: true },
        svg: { keywords: '', htmlComment: true, htmlTag: true, single: true },
        css: { keywords: '', block: true, attr: true, single: true },
        scss: { keywords: '', slash: true, block: true, attr: true, single: true },
        less: { keywords: '', slash: true, block: true, attr: true, single: true },
    };
    const ALIAS = {
        'c++': 'cpp', c: 'c', h: 'cpp', hpp: 'cpp', cc: 'cpp', cxx: 'cpp',
        py: 'python', js: 'javascript', ts: 'typescript',
        rb: 'ruby', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml',
        htm: 'html', xml: 'html', svg: 'html', scss: 'css', less: 'css',
        'c#': 'cs', cs: 'cs', kt: 'kotlin', rs: 'rust', md: '',
        markdown: '', text: '', plaintext: '', plain: '', txt: '',
    };
    const TOKEN = {
        com: 'comment', str: 'string', num: 'number', kw: 'keyword',
        lit: 'boolean', fn: 'function', pre: 'macro', tag: 'tag', attr: 'attr-name',
    };
    const cache = new Map();
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    function build(lang) {
        const p = LANG[lang] || LANG.cpp;
        const parts = [];
        const names = [];
        const add = (name, re) => { names.push(name); parts.push('(' + re + ')'); };
        if (p.preproc) add('pre', '^[ \\t]*#[ \\t]*[A-Za-z]+[^\\n]*');
        if (p.hash) add('com', '#[^\\n]*');
        if (p.slash) add('com', '\\/\\/[^\\n]*');
        if (p.dash) add('com', '--[^\\n]*');
        if (p.block) add('com', '\\/\\*[\\s\\S]*?\\*\\/');
        if (p.htmlComment) add('com', '<!--[\\s\\S]*?-->');
        if (p.triple) add('str', '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'');
        add('str', '"(?:\\\\.|[^"\\\\])*"');
        if (p.single !== false) add('str', "'(?:\\\\.|[^'\\\\])*'");
        if (p.backtick) add('str', '`(?:\\\\.|[^`\\\\])*`');
        if (p.htmlTag) add('tag', '<\\/?[A-Za-z][\\w:-]*');
        if (p.attr) add('attr', '[A-Za-z_-][\\w-]*(?=\\s*:)');
        add('num', '\\b(?:0[xX][\\da-fA-F]+|0[bB][01]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b');
        if (p.keywords) add('kw', '\\b(?:' + p.keywords.trim().replace(/ /g, '|') + ')\\b');
        add('lit', '\\b(?:true|false|null|None|True|False|nil|undefined)\\b');
        add('fn', '\\b[A-Za-z_$][\\w$]*(?=\\s*\\()');
        return { re: new RegExp(parts.join('|'), 'gm'), names };
    }
    function highlight(src, lang) {
        let t = cache.get(lang);
        if (!t) { t = build(lang); cache.set(lang, t); }
        let out = '';
        let last = 0;
        let m;
        t.re.lastIndex = 0;
        while ((m = t.re.exec(src))) {
            out += esc(src.slice(last, m.index));
            let cls = '';
            for (let i = 1; i < m.length; i++) {
                if (m[i] !== undefined) { cls = t.names[i - 1]; break; }
            }
            if (cls === 'pre') {
                const pm = /^([ \t]*)(#)([ \t]*)([A-Za-z]+)([\s\S]*)$/.exec(m[0]);
                if (pm) {
                    const hm = /^([ \t]*)(<[^>\n]*>|"(?:\\.|[^"\\])*")?([\s\S]*)$/.exec(pm[5]);
                    out += '<span class="token macro property tok-pre">' + esc(pm[1])
                        + '<span class="token directive-hash">' + esc(pm[2]) + '</span>' + esc(pm[3])
                        + '<span class="token directive keyword tok-kw">' + esc(pm[4]) + '</span>'
                        + esc(hm[1])
                        + (hm[2] ? '<span class="token string tok-str">' + esc(hm[2]) + '</span>' : '')
                        + esc(hm[3]) + '</span>';
                } else {
                    out += '<span class="token macro tok-pre">' + esc(m[0]) + '</span>';
                }
            } else {
                out += '<span class="token ' + (TOKEN[cls] || cls) + ' tok-' + cls + '">' + esc(m[0]) + '</span>';
            }
            last = t.re.lastIndex;
        }
        return out + esc(src.slice(last));
    }
    function ranges(spec, max) {
        const set = new Set();
        String(spec).split(',').forEach(function (part) {
            const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
            if (!m) return;
            let a = Number(m[1]);
            let b = m[2] ? Number(m[2]) : a;
            if (a > b) { const t = a; a = b; b = t; }
            for (let i = Math.max(1, a); i <= Math.min(max, b); i++) set.add(i);
        });
        const nums = Array.from(set).sort(function (a, b) { return a - b; });
        const out = [];
        nums.forEach(function (n) {
            const last = out[out.length - 1];
            if (last && last.end + 1 === n) last.end = n;
            else out.push({ start: n, end: n });
        });
        return out;
    }
    function addLineNumbers(pre, code, count) {
        if (count < 1 || !pre.classList) return;
        pre.classList.add('line-numbers');
        let rows = '';
        for (let i = 0; i < count; i++) rows += '<span></span>';
        code.innerHTML += '<span class="line-numbers-rows" aria-hidden="true">' + rows + '</span>';
    }
    function addRanges(pre, spec, count) {
        if (!pre.insertAdjacentHTML) return;
        let html = '';
        ranges(spec, count).forEach(function (r) {
            html += '<div class="line-highlight" aria-hidden="true" data-range="'
                + (r.start === r.end ? r.start : r.start + '-' + r.end)
                + '" style="--start:' + r.start + ';--end:' + r.end + ';"></div>';
        });
        if (html) pre.insertAdjacentHTML('afterbegin', html);
    }
    window.highlightCode = function (root) {
        root.querySelectorAll('pre > code').forEach(function (code) {
            const pre = code.parentElement;
            if (!pre || (pre.dataset && pre.dataset.highlighted === '1')) return;
            const m = /(?:^|\s)language-([^\s]+)/.exec(code.className);
            const fenceLang = pre.dataset && pre.dataset.lang ? pre.dataset.lang : '';
            if (!m && !fenceLang) return;
            const raw = (m ? m[1] : fenceLang).toLowerCase();
            if (pre.dataset) pre.dataset.lang = raw;
            const lang = ALIAS[raw] !== undefined ? ALIAS[raw] : raw;
            const options = pre.dataset && pre.dataset.codeOptions ? pre.dataset.codeOptions : '';
            const text = code.textContent.replace(/\n$/, '');
            const count = text === '' ? 0 : text.split('\n').length;
            if (lang && LANG[lang]) code.innerHTML = highlight(code.textContent, lang);
            if (!/\bno-line-numbers\b/.test(options)) {
                addLineNumbers(pre, code, count);
                if (pre.classList) pre.classList.add('hide-numbers');
            }
            const lines = /(?:^|\s)lines=([\d,\-\s]+)/.exec(options);
            if (lines) addRanges(pre, lines[1], count);
            if (pre.dataset) pre.dataset.highlighted = '1';
        });
    };
})();

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'static/js/core/dom.js'), 'utf8');
const results = [];

async function check(name, fn) {
    try {
        await fn();
        results.push(['PASS', name]);
    } catch (e) {
        results.push(['FAIL', name + ' -> ' + e.message]);
    }
}

function loadCopy(env) {
    const start = SRC.indexOf('window.copyToClipboard = function');
    const end = SRC.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, '未找到 copyToClipboard');
    const window = {};
    const fn = new Function('window', 'navigator', 'document', 'setTimeout',
        SRC.slice(start, end + 3) + '\nreturn window.copyToClipboard;')(
        window, env.navigator, env.document, env.setTimeout || setTimeout);
    return fn;
}

function makeDocument(execOk) {
    const state = { area: null, append: null, copied: null, command: '', removed: false };
    const document = {
        createElement(tag) {
            assert.strictEqual(tag, 'textarea');
            const area = {
                value: '', style: {}, attributes: {},
                setAttribute(k, v) { this.attributes[k] = v; },
                focus() { state.focused = this; },
                select() { state.selected = true; },
                setSelectionRange(a, b) { state.range = [a, b]; },
                remove() { state.removed = true; },
            };
            state.area = area;
            return area;
        },
        body: { appendChild(el) { state.append = el; } },
        execCommand(cmd) {
            state.command = cmd;
            state.copied = state.area && state.area.value;
            return execOk;
        },
    };
    return { document, state };
}

function makeButton() {
    const classes = [];
    return {
        textContent: '复制',
        classes,
        classList: {
            contains(c) { return c === 'copy-button' ? false : classes.includes(c); },
            add(c) { if (!classes.includes(c)) classes.push(c); },
            remove(c) { classes.splice(classes.indexOf(c), 1); },
        },
    };
}

(async () => {
    await check('无 Clipboard API 时回退 execCommand', () => {
        const { document, state } = makeDocument(true);
        const fn = loadCopy({ navigator: {}, document, setTimeout: () => 0 });
        const btn = makeButton();
        fn('源码\n<b>x</b>', btn);
        assert.strictEqual(state.command, 'copy');
        assert.strictEqual(state.copied, '源码\n<b>x</b>');
        assert.strictEqual(state.append, state.area);
        assert.strictEqual(state.area.attributes.readonly, '');
        assert.strictEqual(state.focused, state.area);
        assert.deepStrictEqual(state.range, [0, state.area.value.length]);
        assert.strictEqual(state.removed, true);
        assert.strictEqual(btn.textContent, '已复制');
    });

    await check('Clipboard API 拒绝后回退 execCommand', async () => {
        const { document, state } = makeDocument(true);
        const navigator = {
            clipboard: {
                writeText() { return Promise.reject(new Error('denied')); },
            },
        };
        const fn = loadCopy({ navigator, document });
        const btn = makeButton();
        fn('fallback text', btn);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(state.command, 'copy');
        assert.strictEqual(state.copied, 'fallback text');
        assert.strictEqual(btn.textContent, '已复制');
    });

    await check('Clipboard API 成功时不触发回退', async () => {
        let written = null;
        const { document, state } = makeDocument(false);
        const navigator = {
            clipboard: {
                writeText(text) { written = text; return Promise.resolve(); },
            },
        };
        const fn = loadCopy({ navigator, document });
        const btn = makeButton();
        fn('direct text', btn);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.strictEqual(written, 'direct text');
        assert.strictEqual(state.command, '');
        assert.strictEqual(btn.textContent, '已复制');
    });

    await check('自定义成功文案', () => {
        const { document, state } = makeDocument(true);
        const fn = loadCopy({ navigator: {}, document, setTimeout: () => 0 });
        const btn = makeButton();
        fn('x', btn, '✓ 已复制');
        assert.strictEqual(state.command, 'copy');
        assert.strictEqual(state.copied, 'x');
        assert.strictEqual(btn.textContent, '✓ 已复制');
    });

    console.log('\n======== [回归] 前端复制剪贴板 ========');
    for (const [s, n] of results) console.log(s.padEnd(5), n);
    const failed = results.filter((x) => x[0] === 'FAIL').length;
    console.log(results.length - failed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
})();

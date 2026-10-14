// ============================================================
// 消息虚拟滚动（参考微信 / Telegram / Discord 的滑动窗口做法）
//
// 三层结构：
//   数据层   —— 服务端注入的 window.__MESSAGES__（首屏）
//   内存窗口 —— 最多保留 MEMORY_LIMIT 条，溢出后淘汰最老的一条
//   DOM 窗口 —— 只渲染「视口 ± VIEWPORT_BUFFER」与「底部最新 BOTTOM_FIXED」
//
// 高度以估算值为基准，渲染后用 ResizeObserver 实测回写，
// 缺失的节点按估算高度累加，因此 DOM 有空洞时滚动位置依然稳定。
// ============================================================
(function () {

    const MEMORY_LIMIT = 300;    // 内存窗口上限
    const VIEWPORT_BUFFER = 50;  // 视口上下各多渲染多少条
    const BOTTOM_FIXED = 100;    // 底部固定渲染的最新条数
    const ESTIMATED_H = 72;      // 单条消息估算高度
    const LOAD_PAGE = 50;        // 每次加载更老消息的条数
    const TOP_THRESHOLD = 200;   // 距顶部多少像素触发加载更老

    const state = {
        messages: [],
        heights: [],
        // 服务端 messages 接口的 offset 是「已从最新一条起加载了多少条」，
        // 所以下一次回溯要用的 offset 是 oldestLoaded，而不是它减一。
        oldestLoaded: 0,
        newestLoaded: 0,
        total: 0,
        hasMoreOlder: false,
        container: null,
        inner: null,
        stickToBottom: true,   // 用户是否处于「跟随最新」状态
        grewAtTop: false,      // 本次渲染是否在顶部（更旧的一侧）新增了内容
        loadingOlder: false,
        viewMode: 'discuss',
        buildEl: null,
        observer: null,
        rafPending: false,
        enabled: false,
        rendering: false,
        _lastIdsKey: null,
    };

    // ---------- 基础查询 ----------

    // 容器是 flex-direction: column-reverse（见 static/css/discuss.css），
    // scrollTop === 0 就是底部（最新一条），向上滚远离 0。
    //
    // ★ 符号必须抹平：column-reverse 溢出到 start 边时，CSSOM 规范规定
    //   scrollTop 为**负值**（现代 Chrome / Firefox / Safari 都如此），
    //   但旧版 Safari 曾返回**正值**。若直接写 -scrollTop 当「距顶部多远」，
    //   在那些浏览器上 distanceFromTop 会恒为负，
    //   于是 maxScroll - distanceFromTop 永远 >= TOP_THRESHOLD，
    //   回溯加载**永远不触发** —— 而且不报错，只是无限滚动静默失效。
    // 因此所有距离判断一律先取绝对值。
    function offsetFromBottom() {
        const c = state.container;
        if (!c) return 0;
        return Math.abs(c.scrollTop);
    }

    // 距「内容最上端」还有多少像素可滚。
    function distanceFromTop() {
        const c = state.container;
        if (!c) return 0;
        const maxScroll = c.scrollHeight - c.clientHeight;
        return maxScroll - offsetFromBottom();
    }

    function isAtBottom() {
        const c = state.container;
        if (!c) return true;
        return offsetFromBottom() <= 60;
    }

    function scrollToBottom() {
        const c = state.container;
        if (!c) return;
        c.scrollTop = 0;
    }

    function indexOfId(id) {
        if (id === undefined || id === null) return -1;
        for (let i = 0; i < state.messages.length; i++) {
            if (state.messages[i].id === id) return i;
        }
        return -1;
    }

    // ---------- 高度与偏移 ----------

    function heightAt(i) {
        const h = state.heights[i];
        return typeof h === 'number' && h > 0 ? h : ESTIMATED_H;
    }

    // 第 i 条之前所有消息的高度和
    function offsetOf(i) {
        let sum = 0;
        for (let k = 0; k < i; k++) sum += heightAt(k);
        return sum;
    }

// 距容器顶部 y 像素处对应的消息下标。
// n <= MEMORY_LIMIT(300)，线性累加比二分更快且无需维护有序偏移表。
function indexAtY(y) {
        const n = state.messages.length;
        if (n === 0) return 0;
        let acc = 0;
        for (let i = 0; i < n; i++) {
            const h = heightAt(i);
            if (acc + h > y) return i;
            acc += h;
        }
        return n - 1;
    }

    // 实测已渲染节点的高度并回写。
    //
    // ★ 只测真正在视口内的节点：CSS 已对 .message 启用
    //   content-visibility: auto + contain-intrinsic-size: auto 100px，
    //   离屏元素会跳过布局，此时 offsetHeight 返回的是 100px 占位值而非真实高度。
    //   若把占位值写进 heights[]，offsetOf/indexAtY 的偏移表会被彻底污染，
    //   滚动位置开始漂移，且越滚越偏。
    function measure() {
        const inner = state.inner;
        if (!inner) return;
        const c = state.container;
        let cRect = null;
        if (c) cRect = c.getBoundingClientRect();
        const kids = inner.children;
        for (let i = 0; i < kids.length; i++) {
            const el = kids[i];
            const id = el && el.dataset ? el.dataset.id : null;
            if (!id) continue;
            const idx = indexOfId(id);
            if (idx < 0) continue;
            if (cRect) {
                const r = el.getBoundingClientRect();
                // 完全在视口外 → 跳过，不采信占位高度
                if (r.bottom < cRect.top || r.top > cRect.bottom) continue;
            }
            const h = el.offsetHeight;
            if (h > 0) state.heights[idx] = h;
        }
    }

    function scheduleRender() {
        if (state.rafPending) return;
        state.rafPending = true;
        requestAnimationFrame(function () {
            state.rafPending = false;
            renderVisible();
        });
    }

    // ---------- 计算要渲染的范围 ----------

    function computeRenderSet() {
        const total = state.messages.length;
        const ids = new Set();

        // 底部固定窗口
        const bottomStart = Math.max(0, total - BOTTOM_FIXED);
        for (let i = bottomStart; i < total; i++) ids.add(state.messages[i].id);

        // 视口窗口（符号无关：offsetFromBottom 是距底部像素数，向上滚时它单调增大）
        const c = state.container;
        if (c && total > 0) {
            const fromBottom = offsetFromBottom();
            const top = Math.max(0, fromBottom - c.clientHeight);
            const bottom = fromBottom + c.clientHeight * 2;
            let start = indexAtY(top);
            let end = indexAtY(bottom);
            start = Math.max(0, start - VIEWPORT_BUFFER);
            end = Math.min(total - 1, end + VIEWPORT_BUFFER);
            for (let i = start; i <= end; i++) ids.add(state.messages[i].id);
        }
        return ids;
    }

    // ---------- DOM 渲染 ----------

    function renderVisible() {
        if (state.rendering) return;
        state.rendering = true;
        try {
            const container = state.container;
            if (!container) {
                _renderVisibleImpl();
                return;
            }

            // 处于跟随底部状态，或用户本来就在底部 60px 内 → stick
            const atBottom = isAtBottom();
            state.stickToBottom = state.stickToBottom || atBottom;

            const prevH = container.scrollHeight;
            const prevTop = offsetFromBottom();   // 与符号无关

            _renderVisibleImpl();

            // 滚动补偿只在这里做一次（_renderVisibleImpl 内不再重复补偿）
            const grew = container.scrollHeight - prevH;
            if (state.stickToBottom) {
                scrollToBottom();
            } else if (state.grewAtTop && grew !== 0) {
                // 只有「顶部新增」（回溯加载）需要补偿。
                // 依赖浏览器的 CSS scroll anchoring 会与这里重复补偿：
                // Chrome/Firefox 会自动修正、我们又手动改一次 = 跳动两倍；
                // 而 Safari 至今不支持 overflow-anchor，只能靠自己。
                // 因此 .message-list 上已设 overflow-anchor: none，
                // 统一走手动补偿，三种浏览器行为才一致。
                setOffsetFromBottom(container, prevTop + grew);
            }
            state.grewAtTop = false;
        } finally {
            state.rendering = false;
        }
    }

    function _renderVisibleImpl() {
        const inner = state.inner;
        if (!inner) return;

        measure();

        const ids = computeRenderSet();

        // 渲染集合没变就不动 DOM，避免滚动时反复增删造成的抖动
        const key = Array.from(ids).join('|');
        if (state._lastIdsKey === key) return;
        state._lastIdsKey = key;

        // 有消息时移除服务端渲染的空状态占位
        if (state.messages.length > 0) {
            Array.prototype.slice.call(inner.querySelectorAll('.empty, .dm-empty-hint'))
                .forEach(function (el) { el.remove(); });
        }

        // 移除不再需要渲染的消息节点。
        // 无 data-id 的节点（如 .dm-empty 等非消息元素）一律保留。
        const existing = new Map();
        Array.prototype.slice.call(inner.children).forEach(function (el) {
            const id = el && el.dataset ? el.dataset.id : null;
            if (!id) return;
            if (ids.has(id)) {
                existing.set(id, el);
            } else {
                el.remove();
            }
        });

        // 按 messages 的顺序补齐 / 纠正位置
        let prevEl = null;
        for (let i = 0; i < state.messages.length; i++) {
            const msg = state.messages[i];
            if (!ids.has(msg.id)) continue;
            let el = existing.get(msg.id);
            if (!el) {
                el = state.buildEl(msg);
                if (!el) continue;
                el.dataset.id = msg.id;
            }
            const target = prevEl ? prevEl.nextSibling : inner.firstChild;
            if (target !== el) inner.insertBefore(el, target);
            prevEl = el;
        }
    }

    // ---------- 数据变更 ----------

    function appendMessage(msg, opts) {
        if (!msg || msg.id === undefined || msg.id === null) return;
        if (indexOfId(msg.id) >= 0) return;

        state.messages.push(msg);
        state.heights.push(0);
        state.newestLoaded++;
        if (state.newestLoaded > state.total) state.total = state.newestLoaded;

        // 内存窗口淘汰：保留最新 MEMORY_LIMIT 条。
        // 淘汰的是最老一条，不影响「已从最新端加载了多少条」这个计数。
        while (state.messages.length > MEMORY_LIMIT) {
            state.messages.shift();
            state.heights.shift();
        }

        state._lastIdsKey = null;
        // 自己发的消息强制锁定底部
        if (opts && opts.forceScroll) state.stickToBottom = true;

        renderVisible();
        if (state.stickToBottom) {
            requestAnimationFrame(function () {
                scrollToBottom();
            });
        }
    }

    function prependMessages(msgs) {
        if (!msgs || !msgs.length) return;
        const seen = new Set(state.messages.map(function (m) { return m.id; }));
        const toAdd = msgs.filter(function (m) {
            return m && m.id !== undefined && m.id !== null && !seen.has(m.id);
        });
        if (!toAdd.length) return;

        state.messages = toAdd.concat(state.messages);
        state.heights = toAdd.map(function () { return 0; }).concat(state.heights);
        // offset 是「已从最新端加载的条数」，回溯加载只会让它变大
        state.oldestLoaded += toAdd.length;

        // 内存窗口上限：回溯加载同样要受 MEMORY_LIMIT 约束。
        // 从最老一端裁剪——新加载的这些正是用户正在往上翻的内容，
        // 不能反过来裁剪底部（否则会把用户眼前的最新消息删掉）。
        //
        // 注意：这里绝对不能回退 oldestLoaded。offset 的语义是
        // 「已从最新一条起加载了多少条」（服务端 loadMessageRange 就是按这个
        // 数从最新往回数），只会单调变大。被淘汰的条目确实需要重新拉取，
        // 但那正是把 offset 原样再发一次就会拿回来的内容；
        // 一旦在这里减回去，下一次 loadOlder() 会请求刚刚被淘汰的同一页，
        // 于是永远卡在同一处、无限重复拉取。
        while (state.messages.length > MEMORY_LIMIT) {
            state.messages.shift();
            state.heights.shift();
        }
        state._lastIdsKey = null;

        // 回溯加载：新增内容在视觉顶部，需要滚动锚定补偿。
        state.grewAtTop = true;
        // 临时禁用 stick，让外层 renderVisible 走高度差补偿分支，
        // 而不是强制滚到底。仍走统一入口，保留 rendering 递归锁。
        const wasStick = state.stickToBottom;
        state.stickToBottom = false;
        renderVisible();
        state.stickToBottom = wasStick;
    }

    function updateMessage(id, patch) {
        const idx = indexOfId(id);
        if (idx < 0 || !patch) return;
        Object.assign(state.messages[idx], patch);
        scheduleRender();
    }

    function removeMessage(id) {
        const idx = indexOfId(id);
        if (idx < 0) return;
        state.messages.splice(idx, 1);
        state.heights.splice(idx, 1);
        scheduleRender();
    }

    function getMessages() { return state.messages; }

    // ---------- 加载更老 ----------

    function buildLoadOlderUrl(offset, limit) {
        const dn = window.__DOMAIN__ || '';
        const disc = window.__DISCUSS__ || '';
        return '/domain/' + encodeURIComponent(dn)
            + '/discuss/' + encodeURIComponent(disc)
            + '/messages?offset=' + offset + '&limit=' + limit;
    }

    function showLoadingIndicator() {
        const inner = state.inner;
        if (!inner) return;
        if (inner.querySelector('.loading-older')) return;
        const el = document.createElement('div');
        el.className = 'loading-older';
        el.textContent = '正在加载更早的消息…';
        inner.insertBefore(el, inner.firstChild);
    }

    function hideLoadingIndicator() {
        const inner = state.inner;
        if (!inner) return;
        const el = inner.querySelector('.loading-older');
        if (el) el.remove();
    }

    const LOAD_DELAY_MS = 500;

    function loadOlder() {
        if (state.loadingOlder) return Promise.resolve(false);
        if (!state.hasMoreOlder) return Promise.resolve(false);
        if (state.viewMode === 'dm') return Promise.resolve(false);   // 私信暂不支持回溯加载

        const url = buildLoadOlderUrl(state.oldestLoaded, LOAD_PAGE);
        if (!url) { state.hasMoreOlder = false; return Promise.resolve(false); }

        state.loadingOlder = true;
        showLoadingIndicator();

        // 延迟一小段时间再发请求，避免误触顶时立刻插入造成跳动
        return new Promise(function (resolve) {
            setTimeout(function () {
                fetch(url).then(function (r) { return r.json(); }).then(function (res) {
                    hideLoadingIndicator();
                    if (res && res.ok && res.messages && res.messages.length) {
                        prependMessages(res.messages);
                        if (typeof res.total === 'number') state.total = res.total;
                        if (res.has_more === false) {
                            state.oldestLoaded = state.total;
                            state.hasMoreOlder = false;
                        } else {
                            state.hasMoreOlder = state.oldestLoaded < state.total;
                        }
                        state.loadingOlder = false;
                        resolve(true);
                    } else {
                        state.hasMoreOlder = false;
                        state.loadingOlder = false;
                        resolve(false);
                    }
                }).catch(function () {
                    hideLoadingIndicator();
                    state.loadingOlder = false;
                    resolve(false);
                });
            }, LOAD_DELAY_MS);
        });
    }

    // ---------- 定位 ----------

    function scrollToMessage(id) {
        if (indexOfId(id) < 0) return false;
        const inner = state.inner;
        if (!inner) return false;

        // 目标当前不在 DOM 里，先强制渲染出来
        let el = inner.querySelector('.message[data-id="' + id + '"], .dm-msg[data-id="' + id + '"]');
        if (!el) {
            renderSpecific(id);
            el = inner.querySelector('[data-id="' + id + '"]');
        }
        if (!el) return false;

        // 定位到非底部时必须解除「跟随底部」锁存，否则 smooth 滚动过程中
        // scheduleRender 触发的 renderVisible 会把视口强行拉回底部而打架
        state.stickToBottom = false;

        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('highlight');
        setTimeout(function () { el.classList.remove('highlight'); }, 2000);
        return true;
    }

    // 只把指定 id 渲染进 DOM（用于 hash 定位）
    function renderSpecific(id) {
        const inner = state.inner;
        if (!inner) return;
        const existing = new Map();
        Array.prototype.slice.call(inner.children).forEach(function (el) {
            const eid = el && el.dataset ? el.dataset.id : null;
            if (eid && eid !== id) existing.set(eid, el);
        });

        let prevEl = null;
        for (let i = 0; i < state.messages.length; i++) {
            const msg = state.messages[i];
            if (msg.id !== id) continue;
            let el = existing.get(msg.id);
            if (!el) {
                el = state.buildEl(msg);
                if (!el) continue;
                el.dataset.id = msg.id;
            }
            const target = prevEl ? prevEl.nextSibling : inner.firstChild;
            if (target !== el) inner.insertBefore(el, target);
            prevEl = el;
        }
        Array.prototype.slice.call(inner.children).forEach(function (el) {
            const eid = el && el.dataset ? el.dataset.id : null;
            if (eid && eid !== id) el.remove();
        });
    }

    // ---------- 初始化 ----------

    function init(container, opts) {
        opts = opts || {};
        if (!container) return false;

        const injected = Array.isArray(window.__MESSAGES__) ? window.__MESSAGES__ : null;
        if (!injected || typeof opts.buildEl !== 'function') {
            state.enabled = false;
            return false;
        }

        state.container = container;
        state.inner = container.querySelector('.message-list-inner')
            || container.querySelector('.dm-list-inner')
            || container;
        state.viewMode = opts.viewMode || 'discuss';
        state.buildEl = opts.buildEl;

        state.messages = injected.slice();
        state.heights = state.messages.map(function () { return 0; });
        state.total = window.__MESSAGES_TOTAL__ || state.messages.length;
        state.oldestLoaded = (window.__MESSAGES_OFFSET__ || 0) + state.messages.length;
        // newestLoaded 同样是「已从最新端加载的条数」，必须用已加载条数，
        // 不能用服务端给的 total：否则只持有一页(100 条)时每收到一条新消息，
        // appendMessage 里的 total 就会被顶高一条，hasMoreOlder 永远为真，
        // 一直发出注定返回空结果的 /messages 请求。
        state.newestLoaded = state.messages.length;
        state.hasMoreOlder = state.oldestLoaded < state.total;
        state._lastIdsKey = null;

        // 滚动到顶部时回溯加载更老的消息
        let scrollScheduled = false;
        container.addEventListener('scroll', function () {
            // column-reverse 下 scrollTop = 0 是底部，负数是向上滚（见 chat/socket.js）
            state.stickToBottom = Math.abs(container.scrollTop) <= 60;

            if (scrollScheduled) return;
            scrollScheduled = true;
            requestAnimationFrame(function () {
                scrollScheduled = false;
                // 「距顶部还有多远」要用负值换算，再和可滚动总距离比较；
                // 旧写法 container.scrollTop < TOP_THRESHOLD + 100 在
                // column-reverse 下恒成立（scrollTop 永远 <= 0），
                // 等于每次滚动都触发回溯加载。
                const distanceFromTop = -container.scrollTop;
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (maxScroll - distanceFromTop < TOP_THRESHOLD) loadOlder();
                scheduleRender();
            });
        }, { passive: true });

        // 实测高度回写
        if (window.ResizeObserver) {
            state.observer = new ResizeObserver(function () { scheduleRender(); });
            state.observer.observe(state.inner);
        }

        state.enabled = true;
        renderVisible();

        // 三层触发，保证任何时机都能到底
        scrollToBottom();
        requestAnimationFrame(function () {
            scrollToBottom();
            requestAnimationFrame(function () {
                scrollToBottom();
                setTimeout(scrollToBottom, 100);
                setTimeout(scrollToBottom, 300);
            });
        });
        return true;
    }

    window.VirtualScroll = {
        init: init,
        isAtBottom: isAtBottom,
        scrollToBottom: scrollToBottom,
        scrollToMessage: scrollToMessage,
        appendMessage: appendMessage,
        prependMessages: prependMessages,
        updateMessage: updateMessage,
        removeMessage: removeMessage,
        loadOlder: loadOlder,
        renderVisible: renderVisible,
        getMessages: getMessages,
        getOldestOffset: function () { return state.oldestLoaded; },
        getNewestOffset: function () { return state.newestLoaded; },
        isEnabled: function () { return state.enabled; },
    };
})();
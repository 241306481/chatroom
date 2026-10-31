(function () {
    let selected = new Set();
    let batchMode = false;
    function checks() {
        return Array.from(document.querySelectorAll('[data-msg-check]'));
    }
    function refresh() {
        const list = checks();
        selected = new Set(list.filter(el => el.checked).map(el => el.value));
        list.forEach(el => {
            const msg = el.closest('.message');
            if (msg) msg.classList.toggle('selected', el.checked);
        });
        const count = document.getElementById('batchCount');
        if (count) count.textContent = '已选 ' + selected.size + ' 条';
        const all = document.getElementById('batchAll');
        if (all) all.checked = list.length > 0 && list.every(el => el.checked);
    }
    function clear() {
        checks().forEach(el => { el.checked = false; });
        selected.clear();
        refresh();
    }
    function toggleMessageBatch(force) {
        batchMode = typeof force === 'boolean' ? force : !batchMode;
        document.body.classList.toggle('msg-batch-mode', batchMode);
        const bar = document.getElementById('messageBatchBar');
        if (bar) bar.hidden = !batchMode;
        const btn = document.getElementById('batchToggleBtn');
        if (btn) btn.textContent = batchMode ? '取消选择' : '选择';
        if (!batchMode) clear();
    }
    function send(ids, payload) {
        if (!window.ChatWS || !window.ChatWS.isOpen()) {
            window.ChatRender.showToast('连接未就绪');
            return;
        }
        if (ids.length > 100) {
            window.showAlert('一次最多选择 100 条消息');
            return;
        }
        window.ChatWS.send(Object.assign({ message_ids: ids }, payload));
    }
    window.toggleMessageBatch = toggleMessageBatch;
    window.batchPinSelected = function (pinned) {
        if (!selected.size) {
            window.showAlert('请先选择消息');
            return;
        }
        send(Array.from(selected), { type: 'batch_pin', pinned: !!pinned });
    };
    window.batchDeleteSelected = function () {
        if (!selected.size) {
            window.showAlert('请先选择消息');
            return;
        }
        window.showConfirm('删除选中的 ' + selected.size + ' 条消息？').then(function (ok) {
            if (!ok) return;
            send(Array.from(selected), { type: 'batch_delete' });
        });
    };
    window.MessageBatch = {
        clear: clear,
        done: function (count) {
            clear();
            toggleMessageBatch(false);
            if (window.ChatRender && count) window.ChatRender.showToast('已处理 ' + count + ' 条消息');
        },
    };
    document.addEventListener('change', function (e) {
        if (e.target && e.target.matches('[data-msg-check]')) refresh();
        if (e.target && e.target.matches('#batchAll')) {
            checks().forEach(el => { el.checked = e.target.checked; });
            refresh();
        }
    });
    function init() {
        const btn = document.getElementById('batchToggleBtn');
        if (btn) btn.addEventListener('click', function () { toggleMessageBatch(); });
        refresh();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

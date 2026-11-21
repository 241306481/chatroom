(function () {
    function boot() {
        const root = document.querySelector('[data-rate-limit-live]');
        const statusEl = document.querySelector('[data-rate-limit-ws]');
        const sessionEl = document.querySelector('[data-rate-limit-session-count]');
        if (!root || !(window.MY_UID || window.__CURRENT_UID__)) return;
        const WS_PROTOCOL = window.__WS_PROTOCOL__ || 'ws';
        const wsUrl = WS_PROTOCOL + '://' + location.host + '/ws/manage/rate_limits';
        let socket = null;
        let reconnectTimer = null;
        let failCount = 0;
        const RETRY_BASE_MS = 2000;
        const RETRY_MAX_MS = 30000;

        function setStatus(text, ok) {
            if (!statusEl) return;
            statusEl.textContent = text;
            statusEl.style.color = ok ? '#52c41a' : '#ff4d4f';
        }
        function cell(text, width) {
            const td = document.createElement('td');
            if (width) td.style.width = width;
            td.textContent = text == null ? '' : String(text);
            return td;
        }
        function renderTable(action) {
            const wrap = document.createElement('div');
            wrap.style.marginTop = '14px';
            const title = document.createElement('strong');
            title.textContent = action.label || action.action;
            wrap.appendChild(title);
            wrap.appendChild(document.createTextNode(' '));
            const code = document.createElement('code');
            code.textContent = action.action;
            wrap.appendChild(code);
            const table = document.createElement('table');
            table.className = 'user-table';
            table.style.marginTop = '6px';
            const thead = document.createElement('thead');
            const headRow = document.createElement('tr');
            for (const [text, width] of [
                ['维度', '90px'], ['键', ''], ['次数', '80px'], ['剩余秒', '90px'],
            ]) {
                const th = document.createElement('th');
                if (width) th.style.width = width;
                th.textContent = text;
                headRow.appendChild(th);
            }
            thead.appendChild(headRow);
            table.appendChild(thead);
            const tbody = document.createElement('tbody');
            action.live.forEach(item => {
                const tr = document.createElement('tr');
                tr.appendChild(cell(item.dim));
                const keyCell = document.createElement('td');
                const keyCode = document.createElement('code');
                keyCode.textContent = item.key == null ? '' : String(item.key);
                keyCell.appendChild(keyCode);
                tr.appendChild(keyCell);
                tr.appendChild(cell(item.n));
                tr.appendChild(cell(item.secsLeft));
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            wrap.appendChild(table);
            return wrap;
        }
        function render(data) {
            const actions = Array.isArray(data.actions) ? data.actions : [];
            if (sessionEl && data.sessionCount != null) {
                sessionEl.textContent = String(data.sessionCount);
            }
            const visible = actions.filter(a => a && Array.isArray(a.live)
                && a.live.length);
            root.textContent = '';
            if (!visible.length) {
                const empty = document.createElement('p');
                empty.className = 'empty';
                empty.textContent = '当前窗口内暂无有效计数';
                root.appendChild(empty);
                return;
            }
            visible.forEach(action => root.appendChild(renderTable(action)));
        }
        function connect() {
            socket = new WebSocket(wsUrl);
            socket.onopen = () => {
                failCount = 0;
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                setStatus('实时更新中', true);
            };
            socket.onmessage = ev => {
                let data; try { data = JSON.parse(ev.data); } catch (e) { return; }
                if (data && data.type === 'rate_limits') render(data);
            };
            socket.onclose = ev => {
                if (ev && ev.code === 4001) {
                    setStatus('登录已失效', false);
                    setTimeout(function () { location.href = '/login'; }, 1500);
                    return;
                }
                if (ev && ev.code === 4003) {
                    setStatus('无权限实时查看', false);
                    return;
                }
                setStatus('连接已断开，重连中…', false);
                failCount++;
                const delay = Math.min(RETRY_MAX_MS,
                    RETRY_BASE_MS * Math.pow(2, Math.min(failCount - 1, 4)));
                reconnectTimer = setTimeout(connect, delay);
            };
            socket.onerror = () => setStatus('实时连接异常', false);
        }
        connect();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

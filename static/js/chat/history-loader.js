(function () {
    function load(opts) {
        if (!opts || !opts.base) return;
        const limit = opts.limit || 100;
        const maxPages = opts.maxPages || 10;
        let before = opts.before || '';
        let pages = 0;
        function finish() {
            if (opts.done) opts.done();
        }
        function loadPage() {
            const q = '?limit=' + limit + (before
                ? '&before=' + encodeURIComponent(before) : '');
            fetch(opts.base + q, { headers: { 'Accept': 'application/json' } })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (!res || !res.ok || !Array.isArray(res.messages)) {
                        finish();
                        return;
                    }
                    const msgs = res.messages;
                    let found = !opts.anchor;
                    msgs.forEach(function (m) {
                        if (!m || !m.id) return;
                        if (opts.onSeen) opts.onSeen(m);
                        if (opts.hasMessage(m.id)) {
                            if (m.id === opts.anchor) found = true;
                            if (opts.onExisting) opts.onExisting(m);
                            return;
                        }
                        if (opts.onNew) opts.onNew(m);
                    });
                    before = res.next_before
                        || (msgs[0] && msgs[0].id) || '';
                    pages++;
                    if (!found && res.has_more && before && pages < maxPages) {
                        loadPage();
                        return;
                    }
                    finish();
                })
                .catch(function () {
                    if (opts.onError) opts.onError();
                });
        }
        loadPage();
    }
    window.ChatHistoryLoader = { load: load };
})();

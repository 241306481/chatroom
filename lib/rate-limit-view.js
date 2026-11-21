'use strict';
const limiter = require('./rate-limit');
const sessions = require('./auth/sessions');

function build() {
    const config = limiter.listConfig();
    const live = limiter.snapshot();
    const actions = config.map((c) => {
        const per = live[c.action] || {};
        const top = [];
        for (const [dim, list] of Object.entries(per)) {
            for (const item of list) {
                top.push({ dim, key: item.key, n: item.n, secsLeft: item.secsLeft });
            }
        }
        top.sort((a, b) => b.n - a.n);
        return { ...c, live: top.slice(0, 8) };
    });
    let sessionCount = 0;
    try { sessionCount = sessions.listSessions().length; } catch (e) {}
    return { actions, sessionCount };
}

module.exports = { build };

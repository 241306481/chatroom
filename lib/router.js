'use strict';

const routeTable = [];

function route(method, pattern, handler, opts) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, n) => {
        paramNames.push(n); return '([^/]+)';
    }).replace(/\//g, '\\/');
    routeTable.push({ method, regex: new RegExp('^' + regexStr + '$'), paramNames, handler, opts: opts || {} });
}

function findRoute(method, pathname) {
    for (const r of routeTable) {
        if (r.method !== method) continue;
        const m = r.regex.exec(pathname);
        if (!m) continue;
        const params = {};
        for (let i = 0; i < r.paramNames.length; i++) {
            const name = r.paramNames[i];
            let value;
            try { value = decodeURIComponent(m[i + 1]); }
            catch (e) { return null; }
            if (value.includes('/') || value.includes('\\')
                || value.includes('..') || value.includes('\0')) return null;
            params[name] = value;
        }
        return { handler: r.handler, params, opts: r.opts };
    }
    return null;
}

module.exports = { route, findRoute, routeTable };

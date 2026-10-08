'use strict';

const routeTable = [];

function route(method, pattern, handler) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, n) => {
        paramNames.push(n); return '([^/]+)';
    }).replace(/\//g, '\\/');
    routeTable.push({ method, regex: new RegExp('^' + regexStr + '$'), paramNames, handler });
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
        return { handler: r.handler, params };
    }
    return null;
}

const PUBLIC_PATHS = ['/', '/home', '/login', '/register', '/logout', '/users', '/favicon.ico'];

function needsAuth(pathname) {
    if (PUBLIC_PATHS.includes(pathname)) return false;
    if (pathname.startsWith('/static/')) return false;
    if (pathname.startsWith('/ws/')) return false;
    if (/^\/domain\/[^/]+\/(home|discuss|users)(\/|$)/.test(pathname)) return false;
    return true;
}

module.exports = { route, findRoute, needsAuth, routeTable };
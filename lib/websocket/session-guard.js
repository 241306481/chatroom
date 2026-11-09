'use strict';
const auth = require('../auth');
function sessionValid(ws, uid) {
    if (!ws || !ws._token) return false;
    const fresh = auth.getSessionUser(ws._token, {
        ua: ws._ua || '',
        ip: ws._ip || '',
    });
    return !!fresh && String(fresh) === String(uid);
}
module.exports = { sessionValid };

'use strict';
function sessionCookie(token, secure, rememberMs) {
    const attrs = ['token=' + token, 'Path=/'];
    if (rememberMs > 0) attrs.push('Max-Age=' + Math.max(1, Math.floor(rememberMs / 1000)));
    attrs.push('HttpOnly', 'SameSite=Lax');
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
}
function clearSessionCookie(secure) {
    return 'token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : '');
}
module.exports = { sessionCookie, clearSessionCookie };

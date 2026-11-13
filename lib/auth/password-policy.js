'use strict';
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;
function validatePassword(password) {
    const pwd = String(password == null ? '' : password);
    if (!pwd) {
        throw new Error('密码不能为空');
    }
    if (pwd.length < MIN_LENGTH) {
        throw new Error('密码不能少于 ' + MIN_LENGTH + ' 位');
    }
    if (pwd.length > MAX_LENGTH) {
        throw new Error('密码不能超过 ' + MAX_LENGTH + ' 位');
    }
    return true;
}
module.exports = { validatePassword, MIN_LENGTH, MAX_LENGTH };

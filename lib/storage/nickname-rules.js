'use strict';

// 保留昵称
const RESERVED = new Set(['system', 'admin', 'root', 'administrator', '管理员', '系统']);

/**
 * 校验昵称合法性，非法时抛 Error
 * @param {string} nickname
 */
function validateNickname(nickname) {
    const name = String(nickname || '').trim();
    if (!name) throw new Error('昵称不能为空');
    if (name.length < 1 || Array.from(name).length > 32) {
        throw new Error('昵称长度需为 1-32 个字符');
    }
    if (RESERVED.has(name.toLowerCase())) {
        throw new Error('该昵称已被系统保留');
    }
    const first = Array.from(name)[0];
    if (/[0-9]/.test(first)) {
        throw new Error('昵称不能以数字开头');
    }
    // 禁控制字符
    if (/[\x00-\x1f\\\/]/.test(name)) {
        throw new Error('昵称包含非法字符');
    }
    return name;
}

module.exports = { validateNickname, RESERVED };

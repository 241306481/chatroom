'use strict';
const storage = require('./storage');

function refItems(ref) {
    if (!ref || typeof ref !== 'object') return [];
    if (Array.isArray(ref.items) && ref.items.length) {
        return ref.items.filter(item => item && typeof item === 'object');
    }
    return [{ id: ref.id, origin: ref.origin || '' }];
}

function findSource(ref, item) {
    const id = String((item && item.id) || ref.id || '');
    if (!id) return null;
    if (ref.type === 'dm') {
        const from = String(ref.from || ref.peer || '');
        const to = String(ref.to || '');
        if (!from || !to) return null;
        return storage.findDMMessage(from, to, id)
            || storage.findDMMessage(to, from, id);
    }
    const domain = String(ref.domain || '');
    const discuss = String(ref.discuss || '');
    if (!domain || !discuss) return null;
    return storage.findMessage(domain, discuss, id);
}

function sourceContent(ref, item, depth) {
    if (item && typeof item.content === 'string') return item.content;
    if (ref && typeof ref.content === 'string') return ref.content;
    const source = findSource(ref, item);
    if (!source) return '*原消息不存在*';
    if (source.deleted) return '*原消息已删除*';
    if (source.revoked) return '*原消息已撤回*';
    if (source.forwarded_from && depth < 4) {
        return forwardContent(source.forwarded_from, depth + 1);
    }
    return String(source.content || '');
}

function forwardContent(ref, depth) {
    if (!ref || typeof ref !== 'object') return '';
    const items = refItems(ref);
    if (!items.length) return '';
    const level = Number(depth) || 0;
    const parts = items.map(item => {
        const origin = String(item.origin || ref.origin || '转发消息');
        return '> ' + origin + '\n\n' + sourceContent(ref, item, level);
    });
    return storage.sliceChars(parts.join('\n\n---\n\n'), 8000);
}

function editHistory(msg, content, at) {
    const history = msg && Array.isArray(msg.edit_history)
        ? msg.edit_history.slice(-19) : [];
    if (msg && String(msg.content || '') !== String(content || '')) {
        history.push({
            content: String(msg.content || ''),
            edited_at: String(msg.edited_at || msg.created_at || at || ''),
        });
    }
    return history;
}

function historyVersions(msg) {
    const versions = [];
    const history = msg && Array.isArray(msg.edit_history) ? msg.edit_history : [];
    for (const item of history) {
        if (!item || typeof item.content !== 'string') continue;
        versions.push({
            content: item.content,
            edited_at: String(item.edited_at || ''),
        });
    }
    if (msg && msg.edited_at) {
        versions.push({
            content: String(msg.content || ''),
            edited_at: String(msg.edited_at || ''),
        });
    }
    return versions;
}

module.exports = { forwardContent, editHistory, historyVersions };

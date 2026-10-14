'use strict';
// ============================================================
// 展示层格式化
// ============================================================
// 控制台（lib/console/ui.js）与网页（lib/routes/_helpers.js）需要完全一致的
// 体积显示规则，之前各存了一份；两边一旦漂移，同一个文件在终端和页面上
// 会显示成不同大小。这里收敛成唯一实现。

// bytes 为 null/undefined 时返回占位符 —— 缺失不等于 0 B。
function formatSize(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

module.exports = { formatSize };
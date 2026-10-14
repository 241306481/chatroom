'use strict';
const { C, displayWidth } = require('./ui');

// ============================================================
// 帮助表（按原样保留全部命令）
// ============================================================
const SECTIONS = [
    ['用户', [
        ['user list',                       '列出所有用户'],
        ['user online',                     '列出当前在线用户'],
        ['user show <uid>',                 '用户详情'],
        ['user find <nickname>',            '按昵称模糊查找'],
        ['user nick <uid> <name>',          '修改昵称'],
        ['user bio <uid> <text>',           '修改简介'],
        // 权限只能在 Web UI 的 /manage/permissions 修改（system-roles 的写入路径
        // 带原型/角色名校验，开放控制台直写等于绕过它）。这里如实描述为只读命令，
        // 此前写成「修改权限位」并带 <hex> 参数，运维照着敲会以为生效了。
        ['user priv <uid>',                   '查看权限组'],
        ['user avatar <uid> <color>',       '修改头像色'],
        ['user password <uid> <pwd>',       '重置密码'],
        ['user ban <uid> [reason]',         '全局封禁'],
        ['user unban <uid>',                '解除封禁'],
        ['user admin <uid>',                '授予系统管理员'],
        ['user deadmin <uid>',              '撤销系统管理员'],
    ]],
    ['社交', [
        ['user follow <uid> <target>',      '关注'],
        ['user unfollow <uid> <target>',    '取消关注'],
        ['user following <uid>',            '关注列表'],
        ['user followers <uid>',            '粉丝列表'],
        ['user block <uid> <target>',       '拉黑'],
        ['user unblock <uid> <target>',     '解除拉黑'],
        ['user blocked <uid>',              '黑名单'],
        ['user blockedby <uid>',            '被谁拉黑'],
    ]],
    ['私信', [
        ['user dm list <uid> <target>',     '查看私信'],
        ['user dm send <uid> <target> <content>', '发送私信'],
        ['user dm clear <uid> <target>',    '清空私信'],
        ['user dm policy <uid> [policy]',   '查看 / 设置私信策略'],
    ]],
    ['用户文件', [
        ['user file list <uid>',                        '列出文件'],
        ['user file show <uid> <fileId>',               '文件详情'],
        ['user file delete <uid> <fileId>',             '删除文件'],
        ['user file rename <uid> <fileId> <name>',      '重命名文件'],
    ]],
    ['域', [
        ['domain list',                  '列出所有域'],
        ['domain show <name>',           '域详情'],
        ['domain members <name>',        '列出成员'],
        ['domain admins <name>',         '列出管理员'],
        ['domain bans <name>',           '列出封禁'],
        ['domain apps <name>',           '列出加入申请'],
        ['domain roles <name>',          '列出角色'],
        ['domain perms <name>',          '列出角色权限位'],
        ['domain create <name> <display> <owner_uid>', '创建域'],
        ['domain transfer <name> <uid>', '转让所有权'],
        ['domain announce <name> <text>','修改公告'],
        ['domain delete <name>',         '删除域（不可恢复）'],
    ]],
    ['域内成员', [
        ['domain user add <domain> <uid>',              '加入成员'],
        ['domain user kick <domain> <uid>',             '踢出成员'],
        ['domain user ban <domain> <uid> [reason]',     '域封禁'],
        ['domain user unban <domain> <uid>',            '解除域封禁'],
        ['domain user mute <domain> <uid> [minutes]',   '禁言'],
        ['domain user unmute <domain> <uid>',           '解除禁言'],
        ['domain user role <domain> <uid> <role>',      '设置角色'],
    ]],
    ['讨论', [
        ['domain discuss list <domain>',                    '列出讨论'],
        ['domain discuss show <domain> <disc>',             '讨论详情'],
        ['domain discuss create <domain> <disc> [title]',   '创建讨论'],
        ['domain discuss rename <domain> <old> <new>',      '重命名讨论'],
        ['domain discuss title <domain> <disc> <title>',    '设置标题'],
        ['domain discuss clear <domain> <disc>',            '清空消息'],
        ['domain discuss delete <domain> <disc>',           '删除讨论'],
        ['domain discuss pin <domain> <disc> <msgId>',      '置顶消息'],
        ['domain discuss unpin <domain> <disc> <msgId>',    '取消置顶'],
        ['domain discuss rm <domain> <disc> <msgId>',       '删除消息'],
    ]],
    ['域文件', [
        ['domain file list <domain>',                       '列出文件'],
        ['domain file show <domain> <fileId>',              '文件详情'],
        ['domain file delete <domain> <fileId>',            '删除文件'],
        ['domain file rename <domain> <fileId> <name>',     '重命名文件'],
    ]],
    ['系统', [
        ['config show',                  '查看系统配置'],
        ['config set <key> <value>',     '修改配置项'],
        ['stats',                        '统计信息'],
        ['clear / cls',                  '清屏'],
        ['help / ?',                     '显示本帮助'],
        ['exit / quit',                  '退出'],
    ]],
];

// ============================================================
// 打印帮助
// ============================================================
function printHelp() {
    function splitItem(raw) {
        const m = raw.match(/^(.*?)\s+(<[^>]*>.*|\[[^\]]*\].*)$/);
        if (m) return [m[1].trim(), m[2].trim()];
        return [raw.trim(), ''];
    }

    const parsed = SECTIONS.map(([title, items]) => [
        title,
        items.map(([raw, desc]) => {
            const [cmd, args] = splitItem(raw);
            return [cmd, args, desc];
        }),
    ]);

    let cmdW = 0, argW = 0;
    for (const [, items] of parsed) {
        for (const [cmd, args] of items) {
            const cw = displayWidth(cmd);
            const aw = displayWidth(args);
            if (cw > cmdW) cmdW = cw;
            if (aw > argW) argW = aw;
        }
    }
    cmdW += 2;
    argW += 2;

    console.log('');
    for (const [title, items] of parsed) {
        console.log(`${C.bold}${title}${C.reset}`);
        for (const [cmd, args, desc] of items) {
            const cmdPad = ' '.repeat(Math.max(0, cmdW - displayWidth(cmd)));
            const argPad = ' '.repeat(Math.max(0, argW - displayWidth(args)));
            console.log('  '
                + C.cyan  + cmd  + C.reset + cmdPad
                + C.white + args + C.reset + argPad
                + C.gray  + desc + C.reset);
        }
        console.log('');
    }
    console.log(`${C.gray}提示：fileId / msgId 可以只输前 8 位（唯一时自动匹配）${C.reset}`);
}

// ============================================================
// Banner
// ============================================================
function printBanner() {
    console.log(`
${C.cyan}====================================================
                   Chatroom Console
====================================================${C.reset}
${C.gray}输入 ${C.reset}${C.cyan}help${C.reset}${C.gray} 查看命令，${C.reset}${C.cyan}exit${C.reset}${C.gray} 退出${C.reset}
`);
}

module.exports = { printHelp, printBanner };
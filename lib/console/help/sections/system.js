'use strict';
// 帮助表分组之一。新增命令请加到对应分组，不要再堆回单个 help.js。
module.exports = [
    ['系统', [
        ['config show',                  '查看系统配置'],
        ['config set <key> <value>',     '修改配置项'],
        ['stats',                        '统计信息'],
        ['clear / cls',                  '清屏'],
        ['help / ?',                     '显示本帮助'],
        ['exit / quit',                  '退出'],
    ]],
    ['IP 封禁', [
        ['ipban list',                        '列出所有封禁规则'],
        ['ipban add <rule> [until] [reason]', '添加规则（rule 为 4 段点分，每段可用数字 / * / a-b 区间）'],
        ['ipban remove <rule>',               '移除规则'],
        ['ipban check <ip>',                  '判断某 IP 是否被封'],
        ['ipban users',                       '列出有 IP 记录的用户'],
        ['ipban user <uid>',                  '某用户的登录 IP 历史'],
    ]],
    ['封禁数据体检', [
        ['ban audit',      '列出解封时间非法的封禁记录（运行时会按永久封禁处理）'],
        ['ban repair',     '把非法解封时间归一为「永久」，需 ban repair yes 确认'],
    ]],
    ['系统角色', [
        ['sysrole list',                  '列出系统角色与成员数'],
        ['sysrole show <role>',           '角色详情与权限位'],
        ['sysrole members <role>',        '该角色下的用户'],
    ]],
    ['经验 / 等级', [
        ['exp list [n]',                  '经验排行（默认前 20）'],
        ['exp show <uid>',                '查看等级与进度'],
        ['exp add <uid> <delta> [domain]', '增减经验（升级会发私信）'],
    ]],
    ['消息维护', [
        ['msg tail <domain> <disc> [n]',           '查看最后 n 条消息'],
        ['msg send <domain> <disc> <uid> <text>',  '补发一条消息（计入经验）'],
        ['msg react <domain> <disc> <id> <uid> <emoji>', '切换表情'],
        ['msg pin <domain> <disc> <id> [0|1]',    '置顶 / 取消置顶'],
        ['msg rm <domain> <disc> <id>',            '标记删除'],
    ]],
    ['会话', [
        ['session kick <uid>',           '强制该用户全部下线'],
        ['session info <uid>',           '会话状态说明'],
    ]],
];

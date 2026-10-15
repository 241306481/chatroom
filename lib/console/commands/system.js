'use strict';
const storage = require('../../storage');
const { C, padR } = require('../ui');

// 配置
function configShow() {
    const d = storage.loadDomain('system');
    const cfg = d.system_config || {};
    console.log(`${C.bold}系统配置${C.reset}`);
    for (const [k, v] of Object.entries(cfg)) {
        console.log(`  ${C.cyan}${padR(k, 28)}${C.reset}${JSON.stringify(v)}`);
    }
}

const CONFIG_TYPES = {
    site_name: 'string',
    site_announcement: 'string',
    allow_register: 'boolean',
    allow_create_domain: 'boolean',
    allow_file_upload: 'boolean',
    max_domains_per_user: 'number',
    max_file_size_mb: 'number',
    session_timeout_hours: 'number',
};

const TRUE_RE = /^(1|true|on|yes|y)$/i;
const FALSE_RE = /^(0|false|off|no|n)$/i;

function configSet(args) {
    const [key, ...rest] = args;
    const raw = rest.join(' ');
    if (!key) { console.log(`${C.red}用法：config set <key> <value>${C.reset}`); return; }

    const d = storage.loadDomain('system');
    if (!d.system_config) d.system_config = {};

    if (!(key in CONFIG_TYPES)) {
        console.log(`${C.red}✘ 未知配置项：${key}${C.reset}`);
        console.log(`${C.gray}  可用：${Object.keys(CONFIG_TYPES).join(', ')}${C.reset}`);
        return;
    }

    let v;
    const type = CONFIG_TYPES[key];
    if (type === 'boolean') {
        if (TRUE_RE.test(raw)) v = true;
        else if (FALSE_RE.test(raw)) v = false;
        else {
            console.log(`${C.red}✘ 不是合法布尔值：${JSON.stringify(raw)}${C.reset}`);
            console.log(`${C.gray}  可用：1/0 true/false on/off yes/no${C.reset}`);
            return;
        }
    } else if (type === 'number') {
        v = parseInt(raw, 10);
        if (!Number.isFinite(v)) { console.log(`${C.red}✘ 不是合法数字${C.reset}`); return; }
    } else {
        v = raw;
    }
    d.system_config[key] = v;
    storage.saveDomain('system', d);
    console.log(`${C.green}✔ ${key} = ${JSON.stringify(v)}${C.reset}`);
}

// 统计
function stats() {
    const users = storage.listRealUsers();
    const domains = storage.listAllDomains();
    let totalMsg = 0, totalDisc = 0, totalDFile = 0, totalUFile = 0, totalDM = 0;

    for (const dn of domains) {
        const discs = storage.listDiscussions(dn);
        totalDisc += discs.length;
        for (const disc of discs) {
            totalMsg += storage.loadAllMessages(dn, disc).filter(m => !m.deleted).length;
        }
        totalDFile += storage.listDomainFiles(dn).length;
    }
    for (const u of users) {
        totalUFile += storage.listUserFiles(u.id).length;
        totalDM += storage.getTotalUnread(u.id);
    }
    console.log(`${C.bold}系统统计${C.reset}`);
    console.log(`  用户数：    ${users.length}`);
    console.log(`  域数：      ${domains.length}`);
    console.log(`  讨论数：    ${totalDisc}`);
    console.log(`  消息数：    ${totalMsg}`);
    console.log(`  域文件数：  ${totalDFile}`);
    console.log(`  用户文件数：${totalUFile}`);
    console.log(`  未读私信：  ${totalDM}`);
    console.log(`  Node：      ${process.version}`);
    console.log(`  工作目录：  ${storage.ROOT}`);
    console.log(`  数据目录：  ${storage.DATA_DIR}`);
}

module.exports = {
    configShow,
    configSet,
    stats,
    // 省略子命令的默认值
    __default: configShow,
};
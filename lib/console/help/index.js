'use strict';
const { C, displayWidth } = require('../ui');
const user = require('./sections/user');
const domain = require('./sections/domain');
const system = require('./sections/system');

const SECTIONS = [...user, ...domain, ...system];

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

// Banner
function printBanner() {
    console.log(`
${C.cyan}====================================================
                   Chatroom Console
====================================================${C.reset}
${C.gray}输入 ${C.reset}${C.cyan}help${C.reset}${C.gray} 查看命令，${C.reset}${C.cyan}exit${C.reset}${C.gray} 退出${C.reset}
`);
}


module.exports = { printHelp, printBanner };

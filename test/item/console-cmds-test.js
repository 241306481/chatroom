// 验证新增的控制台命令
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
fs.rmSync(ROOT + '/data', { recursive: true, force: true });

const s = require(ROOT + '/lib/storage');
s.ensureDirs(); s.ensureSystemDomain(); s.ensureSystemUser();
const alice = s.createUser('alice', 'pw123456');   // 首个用户 → root, level=99
const bob = s.createUser('bobbb', 'pw123456');      // 第二个 → 需显式 grantRole
const auth = require(ROOT + '/lib/auth');
auth.grantRole('system', bob, 'member');            // 建立成员记录（level 0）

const DISC = s.listDiscussions('system')[0];
s.appendMessage('system', DISC, {
    id: s.genUuid(), uid: alice, nickname: 'alice',
    content: '第一条', at: s.nowIso(), reactions: {},
});
const firstMsg = s.loadAllMessages('system', DISC)[0].id;

function run(lines) {
    const r = spawnSync(process.execPath, [ROOT + '/lib/console/index.js'], {
        cwd: ROOT, input: lines.join('\n') + '\nexit\n', encoding: 'utf8', timeout: 60000,
    });
    return ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '');
}

const results = [];
function check(name, cond, detail) {
    results.push([cond ? 'PASS' : 'FAIL', name + (cond ? '' : ' -> ' + (detail || ''))]);
}

const text = run([
    'ipban list',
    'ipban add 1.2.3.4',
    'ipban add 10.0.0.* 2099-01-01T00:00 压测IP',
    'ipban add 999.1.1.1',
    'ipban add 10.0.0.256',
    'ipban add 8.8.8.8 2099-13-45T00:00 非法日期',
    'ipban list',
    'ipban check 1.2.3.4',
    'ipban check 1.2.3.5',
    'ipban check 10.0.0.7',
    'ipban remove 1.2.3.4',
    'ipban remove 9.9.9.9',
    'ipban list',
    'ipban users',
    'sysrole list',
    'sysrole show admin',
    'sysrole show nosuchrole',
    'sysrole members admin',
    'exp list system',
    'exp show ' + bob + ' system',
    'exp show ' + alice + ' system',
    'exp show ' + alice,
    'exp show 99999 system',
    'exp add ' + bob + ' 500 system',
    'exp add ' + bob + ' abc system',
    'exp add ' + bob + ' 10',
    'exp add ' + bob + ' 10 nosuchdom',
    'exp add ' + bob + ' 10 system',
    'exp show ' + bob + ' system',
    'msg tail system ' + DISC,
    'msg send system ' + DISC + ' ' + bob + ' 控制台补发的一条',
    'msg tail system ' + DISC,
    'msg react system ' + DISC + ' ' + firstMsg + ' ' + bob + ' :smile:',
    'msg pin system ' + DISC + ' ' + firstMsg,
    'msg rm system ' + DISC + ' ' + firstMsg,
    'msg send system nodisc ' + bob + ' x',
    'session kick ' + alice,
    'session kick 99999',
    'config',
    'help',
]);

check('ipban list 空表', /无封禁规则/.test(text));
check('ipban add 永久封禁', /已封禁 1\.2\.3\.4/.test(text));
check('ipban add 通配 + 到期时间', /已封禁 10\.0\.0\.\*/.test(text) && /2099-01-01T00:00:00Z/.test(text));
check('ipban 拒绝非法 IP 段', /IP 段需在 0-255/.test(text));
check('ipban 拒绝非法日期（不得退化成永久）', /解封时间/.test(text));
check('ipban list 显示原因', /压测IP/.test(text));
check('ipban check 命中', /命中规则 1\.2\.3\.4/.test(text));
check('ipban check 未命中', /1\.2\.3\.5.*未被封禁/.test(text));
check('通配符匹配', /10\.0\.0\.7.*命中规则 10\.0\.0\.\*/.test(text));
check('ipban remove 生效', /已移除 1\.2\.3\.4/.test(text));
check('ipban remove 不存在报错', /规则不存在：9\.9\.9\.9/.test(text));
check('ipban users 无记录提示', /暂无 IP 记录/.test(text));
check('sysrole list 列出内置角色', /root/.test(text) && /admin/.test(text));
check('sysrole show 显示权限位', /系统角色 admin/.test(text) && /权限位/.test(text));
check('sysrole show 未知角色报错', /系统角色不存在：nosuchrole/.test(text));
check('sysrole members admin 为空', /该角色下没有用户/.test(text));

check('exp list 有排行', /经验排行/.test(text));
check('exp show 输出等级与进度', new RegExp('bobbb \\(' + bob + '\\)').test(text) && /Lv\./.test(text));
check('exp show 非成员报错', /不是 system 的成员/.test(text));
check('exp show 缺省域仍可用', /bobbb/.test(text));
check('exp show 未知用户报错', /不是 system 的成员|用户不存在/.test(text));
check('exp add 生效并显示升级', /经验 \+500/.test(text) && /Lv\.\d+ → Lv\./.test(text));
check('exp add 非数字报错', /delta 必须是非零整数/.test(text));
check('exp add 缺域报错', /必须指定域/.test(text));
check('exp add 未知域报错', /域不存在：nosuchdom/.test(text));
check('exp add 管理员显式告警而非静默', /level=99|管理员/.test(text));
check('exp add 后等级已变', /经验 0 → 500|Lv\.\d+ → Lv\./.test(text));

check('msg tail 显示消息', /第一条/.test(text));
check('msg send 追加成功并回显 msgId', /追加一条消息/.test(text) && /msgId=/.test(text));
check('msg send 的内容可见', /控制台补发的一条/.test(text));
check('msg react 切换表情', /已切换表情/.test(text));
check('msg pin 置顶', /已置顶/.test(text));
check('msg rm 删除', /已标记删除/.test(text));
check('msg 未知讨论报错', /讨论不存在：system\/nodisc/.test(text));
check('session kick 成功', /已注销 alice 的全部会话/.test(text));
check('session kick 未知用户报错', /用户不存在：99999/.test(text));
check('config 省略子命令走默认', /config|site_name|配置/i.test(text));
check('help 覆盖全部新命令', /ipban list/.test(text) && /exp show/.test(text)
    && /sysrole list/.test(text) && /msg send/.test(text) && /session kick/.test(text));

console.log('======== [回归] 控制台新增命令 ========');
for (const [st, n] of results) console.log(st.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
fs.rmSync(ROOT + '/data', { recursive: true, force: true });
process.exit(f ? 1 : 0);
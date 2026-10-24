'use strict';
// 注册入域：所有用户（含首个超管）都要进 system 主域
//
// 这个用例会动 data 目录，所以必须放在独立子进程里跑，
// 否则会踩掉同批次其它用例的数据。
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const results = [];
const check = (n, f) => {
    try { f(); results.push(['PASS', n]); }
    catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); }
};

check('注册后所有用户都进了 system 域（含首个超管）', () => {
    // 子进程里跑，避免污染当前批次的数据
    // 独立数据目录，不碰真实 data（否则会踩掉同批次其它用例）
    const tmpData = path.join(require('os').tmpdir(),
        'chatroom-uid2-' + Date.now());
    const script = `
        const fs = require('fs');
        const path = require('path');
        const ROOT = ${JSON.stringify(ROOT)};
        const DATA = ${JSON.stringify(tmpData)};
        try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}

        const storage = require(path.join(ROOT, 'lib/storage'));
        const auth = require(path.join(ROOT, 'lib/auth'));
        storage.ensureDirs();
        storage.ensureSystemDomain();
        storage.ensureSystemUser();

        const out = [];
        const u1 = auth.registerUser('first-admin', 'Passw0rd!123', '127.0.0.1');
        const u2 = auth.registerUser('second-user', 'Passw0rd!123', '127.0.0.1');
        const u3 = auth.registerUser('third-user', 'Passw0rd!123', '127.0.0.1');
        const sys = storage.loadDomain('system');
        const members = Object.keys(sys.members || {});
        out.push('members=' + JSON.stringify(members));
        out.push('owner_id=' + sys.owner_id);
        out.push('u1_in=' + !!(sys.members && sys.members[u1]));
        out.push('u2_in=' + !!(sys.members && sys.members[u2]));
        out.push('u3_in=' + !!(sys.members && sys.members[u3]));
        const du = auth.getDomainUser('system', storage.loadUser(u2));
        out.push('u2_is_member=' + du.is_member);
        console.log(out.join('\\n'));
    `;
    const tmp = path.join(ROOT, 'test', 'tmp-uid2-probe.js');
    fs.writeFileSync(tmp, script, 'utf8');
    let stdout = '';
    try {
        const r = spawnSync(process.execPath, [tmp], {
            cwd: ROOT, encoding: 'utf8', timeout: 60000,
            env: { ...process.env, CHATROOM_DATA_DIR: tmpData },
        });
        stdout = r.stdout || '';
        if (r.status !== 0) {
            throw new Error('子进程失败: ' + (r.stderr || '').slice(0, 400));
        }
    } finally {
        try { fs.unlinkSync(tmp); } catch (e) {}
        try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) {}
    }

    const get = (k) => {
        const m = stdout.match(new RegExp(k + '=(.*)'));
        return m ? m[1].trim() : '';
    };

    assert.ok(get('u1_in') === 'true', '首个用户（超管）应在 system 域');
    assert.ok(get('u2_in') === 'true', '第二个用户应在 system 域');
    assert.ok(get('u3_in') === 'true', '第三个用户应在 system 域');
    assert.ok(get('owner_id'), 'system 域应有域主');
    assert.ok(get('u2_is_member') === 'true', '用户应是 system 域成员');
});

check('入域逻辑只在 createUser 一处（不重复实现）', () => {
    const users = fs.readFileSync(path.join(ROOT, 'lib/storage/users.js'), 'utf8')
        .replace(/\r\n/g, '\n');
    const i = users.indexOf('function createUser');
    const body = users.substring(i, users.indexOf('\n}\n', i));
    assert.ok(/domain\.members\[uid\]/.test(body),
        'createUser 应写入域成员（它也被直接调用）');
    assert.ok(/domain\.owner_id = uid/.test(body), '首个用户应成为域主');

    // registerUser 不该再写一遍
    const acc = fs.readFileSync(path.join(ROOT, 'lib/auth/account.js'), 'utf8');
    assert.ok(!/domain\.members\[uid\]/.test(acc),
        'registerUser 不应重复写域成员');
});

console.log('\n======== [回归] 注册入域 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter(x => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
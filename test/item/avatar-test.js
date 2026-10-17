'use strict';
// [回归] 头像全链路
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
process.chdir(ROOT);

const results = [];
const check = (n, f) => { try { f(); results.push(['PASS', n]); } catch (e) { results.push(['FAIL', n + ' -> ' + e.message]); } };

const storage = require(path.join(ROOT, 'lib/storage'));
const avatar = require(path.join(ROOT, 'lib/storage/avatar'));
const avatarView = require(path.join(ROOT, 'lib/avatar-view'));
const { PRIV, hasPriv, PRIV_GROUPS } = require(path.join(ROOT, 'lib/permissions'));

storage.ensureDirs();
storage.ensureSystemDomain();
storage.ensureSystemUser();
try { storage.createUser('avuser', 'pw123456'); } catch (e) {}
const U = storage.findUserByNickname('avuser');
const OTHER = (function () {
    try { storage.createUser('avuser2', 'pw123456'); } catch (e) {}
    return storage.findUserByNickname('avuser2');
})();

// 真实图片字节
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);

function setExt(uid, ext) {
    const r = storage.loadUser(uid);
    if (ext) r.avatar_ext = ext; else delete r.avatar_ext;
    storage.saveUser(uid, r);
}
function reset() {
    avatar.clear(U.id); setExt(U.id, null);
    avatar.clear(OTHER.id); setExt(OTHER.id, null);
}

// 权限位
check('新增 base.upload_avatar 权限位', () => {
    assert.ok(PRIV.BASE.UPLOAD_AVATAR, '权限位缺失');
    assert.strictEqual(PRIV.BASE.UPLOAD_AVATAR, 1 << 6);
});
check('权限元信息已登记（可在权限页勾选）', () => {
    const g = PRIV_GROUPS.find((x) => x.key === 'base.upload_avatar');
    assert.ok(g, '未登记到 PRIV_GROUPS');
    assert.strictEqual(g.group, 'base');
    assert.strictEqual(g.bit, PRIV.BASE.UPLOAD_AVATAR);
    assert.ok(g.name && g.desc, '缺少展示名或说明');
});
check('系统账户默认带该权限', () => {
    const sys = storage.loadUser('1');
    assert.ok(hasPriv(sys, 'base', PRIV.BASE.UPLOAD_AVATAR));
});

// 格式校验（安全关键项）
check('PNG / JPEG / GIF / WebP 按魔数识别', () => {
    assert.strictEqual(avatar.save(U.id, PNG).ext, 'png');
    assert.strictEqual(avatar.save(U.id, JPG).ext, 'jpg');
    assert.strictEqual(avatar.save(U.id, GIF).ext, 'gif');
    assert.strictEqual(avatar.save(U.id, WEBP).ext, 'webp');
});
check('拒绝 SVG（可内嵌脚本）', () => {
    const r = avatar.save(U.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    assert.strictEqual(r.ok, false);
    assert.ok(/仅支持/.test(r.error), r.error);
});
check('拒绝 HTML 改名伪装', () => {
    assert.strictEqual(avatar.save(U.id, Buffer.from('<!DOCTYPE html><script>alert(1)</script>')).ok, false);
});
check('拒绝把脚本伪装成 PNG（前缀垃圾 + 正确魔数也不行）', () => {
    assert.strictEqual(avatar.save(U.id, Buffer.concat([Buffer.from('<script>'), PNG])).ok, false);
});
check('拒绝空文件', () => {
    assert.strictEqual(avatar.save(U.id, Buffer.alloc(0)).ok, false);
});
check('上限为 1 MB', () => {
    assert.strictEqual(avatar.MAX_BYTES, 1024 * 1024);
});
check('拒绝超过 1 MB', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const r = avatar.save(U.id, big);
    assert.strictEqual(r.ok, false);
    assert.ok(/1 MB/.test(r.error), '错误提示应写明 1 MB，实际: ' + r.error);
});
check('前端与文案上限同步为 1 MB', () => {
    const js = fs.readFileSync(path.join(ROOT, 'static/js/avatar-upload.js'), 'utf8');
    assert.ok(!/2 \* 1024 \* 1024/.test(js), '前端仍是 2 MB');
    assert.ok(/1024 \* 1024/.test(js), '前端未用 1 MB');
    const tpl = fs.readFileSync(path.join(ROOT, 'templates/profile.html'), 'utf8');
    assert.ok(tpl.includes('1 MB 以内'), '模板文案未更新');
    assert.ok(!tpl.includes('2 MB'), '模板仍写 2 MB');
});
check('只信魔数，不信传入的文件名与 MIME', () => {
    // 名字是 .svg，内容按魔数判 png
    const r = avatar.save(U.id, PNG);
    assert.strictEqual(r.ext, 'png');
    assert.strictEqual(r.mime, 'image/png');
});

// 读取
check('读取白名单外的扩展名一律 null', () => {
    avatar.save(U.id, PNG);
    for (const ext of ['svg', 'svgz', 'php', 'html', 'js', '', null, undefined, '../png', 'PNG2']) {
        assert.strictEqual(avatar.read(U.id, ext), null, '不该读到: ' + ext);
    }
});
check('扩展名大小写不敏感', () => {
    avatar.save(U.id, PNG);
    assert.ok(avatar.read(U.id, 'PNG'));
    assert.ok(avatar.read(U.id, 'Png'));
});
check('uid 非法时读取被拒（路径穿越）', () => {
    for (const uid of ['../../etc/passwd', '..', '.', 'a/b', '', null]) {
        assert.strictEqual(avatar.read(uid, 'png'), null, '不该读到: ' + uid);
    }
});
check('uid 非法时保存被拒', () => {
    assert.strictEqual(avatar.save('../../evil', PNG).ok, false);
});

// 换格式
check('换格式会删掉旧文件，不留两份', () => {
    avatar.save(U.id, PNG);
    const p1 = avatar.avatarPath(U.id, 'png');
    assert.ok(fs.existsSync(p1));
    avatar.save(U.id, JPG);
    assert.ok(!fs.existsSync(p1), '旧文件残留');
    assert.ok(fs.existsSync(avatar.avatarPath(U.id, 'jpg')));
});
check('clear 会清掉所有格式', () => {
    avatar.save(U.id, PNG);
    avatar.clear(U.id);
    assert.ok(!fs.existsSync(avatar.avatarPath(U.id, 'png')));
});
check('用户之间互不干扰', () => {
    avatar.save(U.id, PNG);
    avatar.save(OTHER.id, JPG);
    assert.ok(fs.existsSync(avatar.avatarPath(U.id, 'png')));
    assert.ok(fs.existsSync(avatar.avatarPath(OTHER.id, 'jpg')));
    assert.ok(!fs.existsSync(avatar.avatarPath(OTHER.id, 'png')));
});

// 渲染
check('avatarSrc 有图出 URL、无图出空串', () => {
    assert.strictEqual(avatarView.avatarSrc({ id: '3', avatar_ext: 'png' }), '/avatar/3/png');
    assert.strictEqual(avatarView.avatarSrc({ id: '3' }), '');
    assert.strictEqual(avatarView.avatarSrc(null), '');
    assert.strictEqual(avatarView.avatarSrc({ id: '3', avatar_ext: 'svg' }), '');
    assert.strictEqual(avatarView.avatarSrc({ id: '3', avatar_ext: '../../x' }), '');
});
check('avatarExtOnDisk 以磁盘为准，能发现字段与文件不一致', () => {
    avatar.save(U.id, PNG); setExt(U.id, 'png');
    assert.strictEqual(avatarView.avatarExtOnDisk(storage.loadUser(U.id)), 'png');
    fs.rmSync(avatar.avatarPath(U.id, 'png'));
    assert.strictEqual(avatarView.avatarExtOnDisk(storage.loadUser(U.id)), '', '文件没了应返回空');
});

check('模板：有图渲染 img，无图隐藏 img 并保留首字', () => {
    const { renderToString } = require(path.join(ROOT, 'lib/template'));
    const SPAN = new RegExp('<span class="user-avatar" style="background:[^"]*">av<');

    avatar.save(U.id, PNG); setExt(U.id, 'png');
    const on = renderToString('users.html', { current_user: {}, nav: {}, users: [storage.loadUser(U.id)] });
    assert.ok(/class="user-avatar avatar-img"/.test(on), '未渲染 img');
    assert.ok(on.indexOf('/avatar/' + U.id + '/png') > 0, 'src 不对');
    assert.ok(!/avatar-img[^>]*display:none/.test(on), '有图时不该隐藏');
    assert.ok(SPAN.test(on), '首字 span 应保留作 onerror 兜底');

    avatar.clear(U.id); setExt(U.id, null);
    const off = renderToString('users.html', { current_user: {}, nav: {}, users: [storage.loadUser(U.id)] });
    assert.ok(/class="user-avatar avatar-img"/.test(off), 'img 元素应在');
    assert.ok(/avatar-img[\s\S]{0,240}display:none/.test(off), '无图时应隐藏 img');
    assert.ok(SPAN.test(off), '首字 span 应显示');
});
check('模板：有图时首字 span 靠 CSS 隐藏，不靠内联样式', () => {
    const css = fs.readFileSync(path.join(ROOT, 'static/css/avatar.css'), 'utf8');
    // 无图时 img 带 style，故用 :not([style]) 区分
    assert.ok(/\.avatar-img:not\(\[style\]\)/.test(css), '缺少 :not([style]) 隐藏规则');
    // 兜底 span 的 class 都要被覆盖
    for (const c of ['avatar-circle', 'user-avatar', 'user-avatar-lg', 'member-avatar',
        'msg-avatar', 'dm-avatar', 'profile-avatar']) {
        assert.ok(new RegExp('\\.avatar-img:not\\(\\[style\\]\\)\\s*~\\s*\\.' + c + '\\b').test(css),
            'CSS 未覆盖兜底 class ' + c);
    }
    // 不能加 !important，会盖过 onerror
    assert.ok(!/\.avatar-img:not\(\[style\]\)[^}]*!important/.test(css), '不能加 !important');
});

check('消息头像 URL 用用户 id 而非消息 id', () => {
    const { renderToString } = require(path.join(ROOT, 'lib/template'));
    // 讨论消息：id 是消息主键，user_id 才是 uid
    const discuss = renderToString('discuss.html', {
        current_user: {}, nav: {}, messages: [{
            id: 'msg-999', user_id: U.id, nickname: 'av', avatar_ext: 'png',
            avatar_color: '#123456', content: 'x', created_at: '2026-01-01T00:00:00Z',
        }],
        topic: { id: 1 }, members: [], candidates: [],
    });
    assert.ok(discuss.indexOf('/avatar/' + U.id + '/png') > 0,
        '讨论消息头像 URL 用了消息 id');
    assert.ok(discuss.indexOf('/avatar/msg-999/png') < 0, '不该用消息 id 拼头像 URL');

    // 私信：id 是私信记录主键，from 才是 uid
    const dm = renderToString('messages.html', {
        current_user: {}, nav: {}, conversations: [],
        target: U.id, target_user: storage.loadUser(U.id),
        messages: [{
            id: 'dm-888', from: U.id, to: '2', nickname: 'av', avatar_ext: 'png',
            avatar_color: '#123456', content: 'x', created_at: '2026-01-01T00:00:00Z',
        }],
        can_send: true, can_send_error: '',
    });
    assert.ok(dm.indexOf('/avatar/' + U.id + '/png') > 0, '私信头像 URL 用了私信记录 id');
    assert.ok(dm.indexOf('/avatar/dm-888/png') < 0, '不该用私信记录 id 拼头像 URL');
});

check('avatarSrc 支持显式指定 uid', () => {
    const av = require(path.join(ROOT, 'lib/avatar-view'));
    assert.strictEqual(av.avatarSrc({ id: 'x1', avatar_ext: 'png' }), '/avatar/x1/png');
    assert.strictEqual(av.avatarSrc({ id: 'msgid', avatar_ext: 'png' }, 'realuid'),
        '/avatar/realuid/png', '第二参数未生效');
    assert.strictEqual(av.avatarSrc({ avatar_ext: 'png' }, 'onlyuid'), '/avatar/onlyuid/png');
    assert.strictEqual(av.avatarSrc({ avatar_ext: 'png' }), '', '既无 id 也无 uid 应为空');
});

check('列表类 DTO 都带 avatar_ext（否则永远回退首字）', () => {
    // 走真实域数据，覆盖正常与封禁两条分支
    const fsx = require(path.join(ROOT, 'lib/routes/_helpers'));
    const dn = storage.loadDomain('system').name || 'system';
    const list = fsx.buildUserList(dn);
    const mine = list.find((u) => String(u.id) === U.id);
    assert.ok(mine, 'buildUserList 里找不到测试用户');
    assert.ok('avatar_ext' in mine, 'buildUserList 漏 avatar_ext');

    // 私信会话列表：既要有 uid 也要有 ext
    const src = fs.readFileSync(path.join(ROOT, 'lib/routes/messages.js'), 'utf8');
    assert.ok(/other:\s*c\.other[\s\S]{0,160}id:\s*u\.id/.test(src),
        '私信会话列表缺 id，avatarSrc 拼不出 URL');
    assert.ok(/other:\s*c\.other[\s\S]{0,200}avatar_ext:\s*u\.avatar_ext/.test(src),
        '私信会话列表缺 avatar_ext');

    // 其余列表型路由逐个确认没有漏
    for (const f of ['lib/routes/home.js', 'lib/routes/admin.js', 'lib/routes/user.js']) {
        const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
        const hit = t.match(/avatar_color:\s*u\.avatar_color[^\n]*/g) || [];
        assert.ok(hit.length && hit.every((l) => /avatar_ext/.test(l)),
            f + ' 的列表 DTO 漏 avatar_ext');
    }
});

check('头像控件在昵称之后、bio 之前，且随保存提交', () => {
    const { renderToString } = require(path.join(ROOT, 'lib/template'));
    const html = renderToString('profile.html', {
        target: { id: '7', nickname: 'av', avatar_ext: 'png', avatar_color: '#123', bio: '' },
        current_user: {}, nav: {}, is_me: true, can_avatar: true,
    });
    // bioInput 由宏渲染，只能在结果里找
    const nick = html.indexOf('name="nickname"');
    const av = html.indexOf('id="avatarFile"');
    const bio = html.indexOf('id="bioInput"');
    assert.ok(nick > 0, '未渲染昵称输入框');
    assert.ok(av > 0, '未渲染头像文件输入');
    assert.ok(bio > 0, '未渲染 bio 输入框');
    assert.ok(nick < av, '头像控件应紧跟在昵称后');
    assert.ok(av < bio, '头像控件不应排到 bio 之后');

    const tpl = fs.readFileSync(path.join(ROOT, 'templates/profile.html'), 'utf8');
    // 表单要能带文件
    assert.ok(/enctype="multipart\/form-data"/.test(tpl), '表单缺 enctype');
    assert.ok(/name="avatar_file"/.test(tpl), '缺 avatar_file 字段');
    assert.ok(/name="avatar_remove"/.test(tpl), '缺 avatar_remove 字段');
    // 不再有立即上传 + reload
    const js = fs.readFileSync(path.join(ROOT, 'static/js/avatar-upload.js'), 'utf8');
    assert.ok(!/location\.reload\(\)/.test(js), '不应再立刻 reload');
    assert.ok(!/\/settings\/avatar'/.test(js), '不应再走独立上传接口');
});

check('/user/:uid 支持 multipart 一起提交头像', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/routes/user.js'), 'utf8');
    assert.ok(src.includes('multipart') && src.includes('parseMultipart'), '未识别 multipart');
    assert.ok(/parseMultipart/.test(src), '未解析 multipart');
    assert.ok(/avatar_file/.test(src), '未取 avatar_file');
    assert.ok(/avatar_remove/.test(src), '未处理 avatar_remove');
    // 普通表单提交时不能动头像
    assert.ok(/if \(!\/multipart/.test(src), '普通提交应跳过头像处理');
});

check('模板不产生 XSS：昵称与 ext 均被处理', () => {
    const { renderToString } = require(path.join(ROOT, 'lib/template'));
    const evil = { id: U.id, nickname: '"><script>alert(1)</script>', avatar_ext: 'png', avatar_color: 'red' };
    const out = renderToString('users.html', { current_user: {}, nav: {}, users: [evil] });
    assert.ok(!/<script>alert/.test(out), '昵称里的 script 未被转义');
    assert.ok(out.indexOf('/avatar/' + U.id + '/png') > 0);
    const evil2 = { id: U.id, nickname: 'x', avatar_ext: '" onerror="alert(1)', avatar_color: 'red' };
    const out2 = renderToString('users.html', { current_user: {}, nav: {}, users: [evil2] });
    // ext 非法要空 src，且只留模板那一个 onerror
    assert.ok(/src=""/.test(out2), '非法 ext 应产出空 src');
    const imgTag = (out2.match(/<img class="user-avatar avatar-img"[\s\S]*?>/) || [''])[0];
    assert.strictEqual((imgTag.match(/onerror=/g) || []).length, 1,
        'img 上出现了注入的 onerror');
    assert.ok(!/<script>alert/.test(out2), 'ext 注入未挡住');
});
check('头像过滤器不做 HTML 拼接（避免需要 | safe）', () => {
    const tpl = require('fs').readFileSync(path.join(ROOT, 'lib/template.js'), 'utf8');
    assert.ok(!/avatarImg/.test(tpl), '不应再有出 HTML 的 avatarImg 过滤器');
    assert.ok(/avatarSrc/.test(tpl), '应有 avatarSrc 过滤器');
});

// 路由与门控
check('头像路由已注册且路径无歧义', () => {
    require(path.join(ROOT, 'lib/routes'));
    const r = require(path.join(ROOT, 'lib/router'));
    // 同一路径只查一次并复用结果
    const getAvatar = r.findRoute('GET', '/avatar/7/png');
    assert.ok(getAvatar, '读取路由缺失');
    // 路由按 . 切分，不能用 uid.:ext
    assert.strictEqual(getAvatar.params.ext, 'png', '扩展名解析错误（. 未转义）');
    assert.strictEqual(getAvatar.params.uid, '7');
    assert.ok(r.findRoute('POST', '/settings/avatar'), '上传路由缺失');
    assert.ok(r.findRoute('POST', '/settings/avatar/clear'), '删除路由缺失');
    // 不被 /user/:uid 抢走
    const post = r.findRoute('POST', '/settings/avatar');
    assert.ok(!post.params.uid, '被 /user/:uid 抢走了');
    assert.ok(r.findRoute('POST', '/user/5').params.uid === '5', '/user/:uid 仍应正常');
});
check('头像读取响应带 nosniff 与 CSP', () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'lib/routes/avatar.js'), 'utf8');
    assert.ok(/X-Content-Type-Options/.test(src), '缺 nosniff');
    assert.ok(/Content-Security-Policy/.test(src), '缺 CSP');
});
check('canSetAvatar 依赖权限位', () => {
    const { canSetAvatar } = require(path.join(ROOT, 'lib/routes/avatar'));
    assert.strictEqual(canSetAvatar(null), false);
    assert.strictEqual(canSetAvatar({}), false);
    const noPriv = { id: '9', privs: {} };
    assert.strictEqual(canSetAvatar(noPriv), false, '无权限应拒绝');
    const withPriv = { id: '9', privs: { base: PRIV.BASE.UPLOAD_AVATAR } };
    assert.strictEqual(canSetAvatar(withPriv), true, '有权限应放行');
});

// 控制台
check('控制台 user avatar 支持设图与 clear', () => {
    const src = require('fs').readFileSync(path.join(ROOT, 'lib/console/commands/user/profile.js'), 'utf8');
    assert.ok(/clear/.test(src), '缺 clear 分支');
    assert.ok(/readFileSync/.test(src), '缺读图文件的分支');
    assert.ok(/avatar_ext/.test(src), '未写入 avatar_ext');
});

reset();
console.log('\n======== [回归] 图片头像 ========');
for (const [s, n] of results) console.log(s.padEnd(5), n);
const f = results.filter((x) => x[0] === 'FAIL').length;
console.log(results.length - f + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
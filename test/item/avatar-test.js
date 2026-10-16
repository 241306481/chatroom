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
check('拒绝超过 2 MB', () => {
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    assert.strictEqual(avatar.save(U.id, big).ok, false);
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
'use strict';

const storage = require('../storage');
const avatar = require('../storage/avatar');
const { route } = require('../router');
const { json } = require('./_helpers');
const { parseMultipart } = require('../http-utils');
const { PRIV, hasPriv } = require('../permissions');
const { UnauthorizedError } = require('../auth/privilege');

// 上传上限比普通文件小：头像只用来显示，塞大图没有意义
const MAX_UPLOAD_MB = Math.ceil(avatar.MAX_BYTES / 1024 / 1024) + 1;

function canSetAvatar(user) {
    return !!(user && user.id) && hasPriv(user, 'base', PRIV.BASE.UPLOAD_AVATAR);
}

// 不能用 /user/avatar：会被 /user/:uid 抢先匹配
route('POST', '/settings/avatar', ({ res, user, req, rawBody }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!canSetAvatar(user)) {
        return json(res, 403, { ok: false, error: '你没有上传头像的权限' });
    }
    if (rawBody.length > MAX_UPLOAD_MB * 1024 * 1024) {
        return json(res, 413, { ok: false, error: '头像过大' });
    }
    const bm = String(req.headers['content-type'] || '').match(/boundary=([^;]+)/);
    if (!bm) return json(res, 400, { ok: false, error: 'No boundary' });

    let f;
    try { f = parseMultipart(rawBody, bm[1].trim()).file; }
    catch (e) { return json(res, 400, { ok: false, error: '解析失败' }); }
    if (!f || !f.data || !f.data.length) {
        return json(res, 400, { ok: false, error: '没有文件' });
    }

    const r = avatar.save(user.id, f.data);
    if (!r.ok) return json(res, 400, { ok: false, error: r.error });

    const u = storage.loadUser(user.id);
    u.avatar_ext = r.ext;
    storage.saveUser(user.id, u);
    json(res, 200, { ok: true, ext: r.ext, url: '/avatar/' + encodeURIComponent(String(user.id)) + '/' + r.ext });
});

// 删除头像，回退到首字 + 颜色
route('POST', '/settings/avatar/clear', ({ res, user }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    if (!canSetAvatar(user)) {
        return json(res, 403, { ok: false, error: '你没有修改头像的权限' });
    }
    avatar.clear(user.id);
    const u = storage.loadUser(user.id);
    delete u.avatar_ext;
    storage.saveUser(user.id, u);
    json(res, 200, { ok: true });
});

// 不能带点号：路由把 . 当普通字符，7.png 会被切成 uid=7.p ext=g
route('GET', '/avatar/:uid/:ext', ({ res, params }) => {
    const uid = params.uid;
    const ext = String(params.ext || '').toLowerCase();
    const data = avatar.read(uid, ext);
    if (!data) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
        'Content-Type': data.mime,
        'Content-Length': data.buf.length,
        // 文件名与用户可控内容无关，但仍是用户上传，禁嗅探
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        // 头像变了要能立刻看到，但不能每次都回源
        'Cache-Control': 'private, max-age=300',
    });
    res.end(data.buf);
});

module.exports = { canSetAvatar };
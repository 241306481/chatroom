'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render404, render403 } = require('../template');
const { json, limitMessage } = require('./_helpers');
const { PRIV } = require('../permissions');
const {
    UnauthorizedError, checkPriv, checkDual,
} = require('../auth/privilege');
const { handleUpload, serveFile, limitDownload } = require('./files');
function uploadLimited(req, res, user) {
    const limiter = require('../rate-limit');
    const limited = limiter.check('upload_file', {
        ip: req._clientIp || '',
        account: user.id,
    });
    if (limited) {
        json(res, 403, {
            ok: false,
            error: limitMessage('上传', limited),
            retry_after: limited.leftSec,
        });
        return true;
    }
    limiter.note('upload_file', { ip: req._clientIp || '', account: user.id });
    return false;
}
function maxFileMb() {
    return (storage.loadDomain('system').system_config || {}).max_file_size_mb || 50;
}
route('POST', '/messages/:peer/files/upload', ({ res, user, params, rawBody, req }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    checkPriv(user, 'base', PRIV.BASE.SEND_DM);
    checkPriv(user, 'base', PRIV.BASE.UPLOAD_FILE);
    const peer = params.peer;
    const target = storage.loadUser(peer);
    if (!target.id) return json(res, 404, { ok: false, error: '对方不存在' });
    const chk = storage.canSendDM(user.id, peer);
    if (!chk.ok) return json(res, 403, { ok: false, error: chk.error });
    if (uploadLimited(req, res, user)) return;
    handleUpload(res, rawBody, req, maxFileMb(), f =>
        storage.addDMAttachment(user.id, peer, {
            filename: f.filename || 'unnamed',
            mime: f.mime || 'application/octet-stream',
            buffer: f.data,
            uploader: user.id,
        })
    );
});
function dmAttachment(res, user, params, forceDownload, req) {
    if (!user || !user.id) throw new UnauthorizedError();
    checkPriv(user, 'base', PRIV.BASE.SEND_DM);
    const { uid1, uid2, file_id: fileId } = params;
    if (String(user.id) !== String(uid1) && String(user.id) !== String(uid2)) {
        return render403(res, '无权查看该附件');
    }
    if (forceDownload && !limitDownload(res, req, user)) return;
    const f = storage.getDMAttachment(uid1, uid2, fileId);
    if (!f) return render404(res);
    const buf = storage.getDMAttachmentContent(uid1, uid2, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime, forceDownload);
}
route('GET', '/messages/file/:uid1/:uid2/:file_id', ({ res, user, params, req }) =>
    dmAttachment(res, user, params, false, req));
route('GET', '/messages/file/:uid1/:uid2/:file_id/download', ({ res, user, params, req }) =>
    dmAttachment(res, user, params, true, req));
route('POST', '/domain/:domain_name/discuss/:disc_name/files/upload',
    ({ res, user, params, rawBody, req }) => {
    const { domain_name: dn, disc_name: disc } = params;
    if (!user || !user.id) throw new UnauthorizedError();
    if (!storage.domainExists(dn)) return json(res, 404, { ok: false, error: '域不存在' });
    if (!storage.loadDiscussion(dn, disc).name) {
        return json(res, 404, { ok: false, error: '讨论不存在' });
    }
    const du = auth.getDomainUser(dn, user);
    try {
        checkDual(user, du, 'view_discussion');
        checkDual(user, du, 'send_message');
        checkDual(user, du, 'upload_file');
    } catch (e) {
        return json(res, e.status || 403, { ok: false, error: e.message });
    }
    if (du.is_muted) return json(res, 403, { ok: false, error: '你已被禁言' });
    if (uploadLimited(req, res, user)) return;
    handleUpload(res, rawBody, req, maxFileMb(), f =>
        storage.addDiscussAttachment(dn, disc, {
            filename: f.filename || 'unnamed',
            mime: f.mime || 'application/octet-stream',
            buffer: f.data,
            uploader: user.id,
        })
    );
});
function discussAttachment(res, user, params, forceDownload, req) {
    const { domain_name: dn, disc_name: disc, file_id: fileId } = params;
    if (!storage.domainExists(dn)) return render404(res);
    if (!storage.loadDiscussion(dn, disc).name) return render404(res);
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'view_discussion');
    if (forceDownload && !limitDownload(res, req, user)) return;
    const f = storage.getDiscussAttachment(dn, disc, fileId);
    if (!f) return render404(res);
    const buf = storage.getDiscussAttachmentContent(dn, disc, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime, forceDownload);
}
route('GET', '/domain/:domain_name/discuss/:disc_name/file/:file_id',
    ({ res, user, params, req }) => discussAttachment(res, user, params, false, req));
route('GET', '/domain/:domain_name/discuss/:disc_name/file/:file_id/download',
    ({ res, user, params, req }) => discussAttachment(res, user, params, true, req));

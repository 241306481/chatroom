'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render, render403, render404 } = require('../template');
const { redirect, deny401, buildNav, formatFileItem } = require('./_helpers');
const { withSiteName } = require('./home');
const { PRIV, PERM, hasPriv, hasPerm } = require('../permissions');
const { parseMultipart } = require('../http-utils');

function handleUpload(res, rawBody, req, maxMb, storeFn) {
    if (rawBody.length > maxMb * 1024 * 1024 + 1024 * 1024) {
        return require('./_helpers').json(res, 200, { ok: false, error: `文件超过 ${maxMb} MB` });
    }
    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=([^;]+)/);
    if (!bm) return require('./_helpers').json(res, 400, { ok: false, error: 'No boundary' });
    try {
        const parsed = parseMultipart(rawBody, bm[1].trim());
        const f = parsed.file;
        if (!f || !f.data || f.data.length === 0) {
            return require('./_helpers').json(res, 400, { ok: false, error: '没有文件' });
        }
        const meta = storeFn(f);
        require('./_helpers').json(res, 200, { ok: true, file: { id: meta.id, filename: meta.filename } });
    } catch (e) {
        console.error('[Upload]', e);
        require('./_helpers').json(res, 500, { ok: false, error: e.message });
    }
}

// ---------- 我的文件 ----------
route('GET', '/myfile', ({ res, user }) => {
    if (!user || !user.id) return deny401(res);
    const files = storage.listUserFiles(user.id).map(f => ({ ...formatFileItem(f), is_own: true }));
    render(res, 'myfile.html', withSiteName({
        current_user: user, nav: buildNav(user), files,
        max_file_size_mb: (storage.loadDomain('system').system_config || {}).max_file_size_mb || 50,
    }));
});

route('POST', '/myfile/upload', ({ res, user, rawBody, req }) => {
    if (!user || !user.id) return deny401(res);
    const cfg = storage.loadDomain('system').system_config || {};
    handleUpload(res, rawBody, req, cfg.max_file_size_mb || 50, f =>
        storage.addUserFile(user.id, {
            filename: f.filename || 'unnamed',
            mime: f.mime || 'application/octet-stream',
            buffer: f.data,
        })
    );
});

route('GET', '/myfile/:file_id/download', ({ res, user, params }) => {
    if (!user || !user.id) return deny401(res);
    const f = storage.getUserFile(user.id, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getUserFileContent(user.id, f.id);
    if (!buf) return render404(res);
    res.writeHead(200, {
        'Content-Type': f.mime || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(f.filename)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        'Content-Length': buf.length,
    });
    res.end(buf);
});

route('GET', '/myfile/:file_id', ({ res, user, params }) => {
    if (!user || !user.id) return deny401(res);
    const f = storage.getUserFile(user.id, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getUserFileContent(user.id, f.id);
    if (!buf) return render404(res);
    const mime = f.mime || 'application/octet-stream';
    const inline = /^(image\/|text\/plain|application\/pdf|video\/|audio\/)/.test(mime);
    const enc = encodeURIComponent(f.filename);
    res.writeHead(200, {
        'Content-Type': mime,
        'Content-Disposition': (inline ? 'inline' : 'attachment')
            + `; filename="${enc}"; filename*=UTF-8''${enc}`,
        'Content-Length': buf.length,
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
});

route('POST', '/myfile/:file_id/delete', ({ res, user, params }) => {
    if (!user || !user.id) return deny401(res);
    storage.deleteUserFile(user.id, params.file_id);
    redirect(res, '/myfile');
});

route('POST', '/myfile/:file_id/rename', ({ res, user, params, form }) => {
    if (!user || !user.id) return deny401(res);
    try {
        const meta = storage.renameUserFile(user.id, params.file_id, form.filename || '');
        require('./_helpers').json(res, 200, { ok: true, filename: meta.filename });
    } catch (e) {
        require('./_helpers').json(res, 200, { ok: false, error: e.message });
    }
});

// ---------- 域文件 ----------
route('GET', '/domain/:domain_name/files', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW_FILE)) return render403(res, '你没有查看文件的权限');
    const files = storage.listDomainFiles(dn).map(f => ({
        ...formatFileItem(f),
        is_own: user && f.uploader === user.id,
    }));
    render(res, 'domain_files.html', withSiteName({
        domain_name: dn,
        display_name: storage.loadDomain(dn).display_name || dn,
        current_user: user || {}, nav: buildNav(user, dn),
        files,
        can_upload: hasPerm(du.perm, PERM.UPLOAD_FILE),
        can_delete_any: hasPerm(du.perm, PERM.DELETE_ANY_FILE),
        max_file_size_mb: (storage.loadDomain('system').system_config || {}).max_file_size_mb || 50,
    }));
});

route('POST', '/domain/:domain_name/files/upload', ({ res, user, params, rawBody, req }) => {
    const dn = params.domain_name;
    if (!user || !user.id) return deny401(res);
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.UPLOAD_FILE)) {
        return require('./_helpers').json(res, 403, { ok: false, error: '无上传权限' });
    }
    const cfg = storage.loadDomain('system').system_config || {};
    handleUpload(res, rawBody, req, cfg.max_file_size_mb || 50, f =>
        storage.addDomainFile(dn, {
            filename: f.filename || 'unnamed',
            mime: f.mime || 'application/octet-stream',
            buffer: f.data,
            uploader: user.id,
        })
    );
});

route('GET', '/domain/:domain_name/files/:file_id/download', ({ res, user, params }) => {
    const dn = params.domain_name;
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW_FILE)) return render403(res, '你没有下载文件的权限');
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getDomainFileContent(dn, f.id);
    if (!buf) return render404(res);
    res.writeHead(200, {
        'Content-Type': f.mime || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(f.filename)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        'Content-Length': buf.length,
    });
    res.end(buf);
});

route('GET', '/domain/:domain_name/files/:file_id', ({ res, user, params }) => {
    const dn = params.domain_name;
    const du = auth.getDomainUser(dn, user);
    if (!hasPerm(du.perm, PERM.VIEW_FILE)) return render403(res, '你没有查看文件的权限');
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getDomainFileContent(dn, f.id);
    if (!buf) return render404(res);
    const mime = f.mime || 'application/octet-stream';
    const inline = /^(image\/|text\/plain|application\/pdf|video\/|audio\/)/.test(mime);
    const enc = encodeURIComponent(f.filename);
    res.writeHead(200, {
        'Content-Type': mime,
        'Content-Disposition': (inline ? 'inline' : 'attachment')
            + `; filename="${enc}"; filename*=UTF-8''${enc}`,
        'Content-Length': buf.length,
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
});

route('POST', '/domain/:domain_name/files/:file_id/delete', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) return deny401(res);
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) { res.writeHead(404); res.end(); return; }
    const du = auth.getDomainUser(dn, user);
    const isOwn = f.uploader === user.id;
    const canDelete = (isOwn && hasPerm(du.perm, PERM.DELETE_OWN_FILE))
        || hasPerm(du.perm, PERM.DELETE_ANY_FILE);
    if (!canDelete) return render403(res, '你没有删除此文件的权限');
    storage.deleteDomainFile(dn, f.id);
    redirect(res, `/domain/${dn}/files`);
});

route('POST', '/domain/:domain_name/files/:file_id/rename', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) return deny401(res);
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) return require('./_helpers').json(res, 404, { ok: false, error: '文件不存在' });
    const du = auth.getDomainUser(dn, user);
    const isOwn = f.uploader === user.id;
    const superAdmin = hasPriv(user.priv || 0, PRIV.MANAGE_ALL_DOMAIN);
    const canRename = isOwn || hasPerm(du.perm, PERM.DELETE_ANY_FILE) || superAdmin;
    if (!canRename) return require('./_helpers').json(res, 403, { ok: false, error: '无权限' });
    try {
        const meta = storage.renameDomainFile(dn, params.file_id, form.filename || '');
        require('./_helpers').json(res, 200, { ok: true, filename: meta.filename });
    } catch (e) {
        require('./_helpers').json(res, 200, { ok: false, error: e.message });
    }
});
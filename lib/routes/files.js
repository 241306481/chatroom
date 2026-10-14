'use strict';
const storage = require('../storage');
const auth = require('../auth');
const { route } = require('../router');
const { render, render404, render403 } = require('../template');
const { redirect, buildNav, formatFileItem } = require('./_helpers');
const { withSiteName } = require('./home');
const { PRIV, PERM, hasPriv, hasPerm } = require('../permissions');
const { parseMultipart } = require('../http-utils');
const { UnauthorizedError, PrivilegeError, checkPriv, checkDual } = require('../auth/privilege');

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
        // 走统一 logger，避免上传失败在日志审查中不可见；
        // 同时不回显 e.message（fs.* 报错会泄露服务器绝对路径）
        require('../logger').error('Upload Error:', e);
        require('./_helpers').json(res, 500, { ok: false, error: '文件处理失败' });
    }
}

// 只允许明确无脚本能力的类型内联渲染。
// 不能用 /^image\// 这类前缀匹配 —— image/svg+xml 可携带 <script>，
// 同源 inline 渲染即构成存储型 XSS。
const INLINE_SAFE_MIME = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/avif',
    'video/mp4', 'video/webm', 'video/ogg',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac',
    'application/pdf', 'text/plain',
]);

// ---------- 我的文件 ----------
function serveFile(res, buf, filename, mime, forceAttachment) {
    const safeMime = mime || 'application/octet-stream';
    const baseMime = String(safeMime).split(';')[0].trim().toLowerCase();
    const inline = !forceAttachment && INLINE_SAFE_MIME.has(baseMime);
    const enc = encodeURIComponent(filename || 'file');
    const headers = {
        'Content-Type': safeMime,
        'Content-Disposition': (inline ? 'inline' : 'attachment')
            + `; filename="${enc}"; filename*=UTF-8''${enc}`,
        'Content-Length': buf.length,
        'X-Content-Type-Options': 'nosniff',
        // 即使被判为 attachment，也禁止浏览器嗅探或执行内嵌脚本
        'Content-Security-Policy': "default-src 'none'; sandbox",
    };
    if (!inline) headers['X-Download-Options'] = 'noopen';
    res.writeHead(200, headers);
    res.end(buf);
}

route('GET', '/myfile', ({ res, user }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const files = storage.listUserFiles(user.id).map(f => ({ ...formatFileItem(f), is_own: true }));
    render(res, 'myfile.html', withSiteName({
        current_user: user, nav: buildNav(user), files,
        max_file_size_mb: (storage.loadDomain('system').system_config || {}).max_file_size_mb || 50,
    }));
});

route('POST', '/myfile/upload', ({ res, user, query, rawBody, req }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    checkPriv(user, 'base', PRIV.BASE.UPLOAD_FILE);
    const cfg = storage.loadDomain('system').system_config || {};
    const visibility = (query && query.visibility === 'public') ? 'public' : 'private';
    handleUpload(res, rawBody, req, cfg.max_file_size_mb || 50, f =>
        storage.addUserFile(user.id, {
            filename: f.filename || 'unnamed',
            mime: f.mime || 'application/octet-stream',
            buffer: f.data,
            visibility,
        })
    );
});

route('GET', '/myfile/:file_id/download', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const f = storage.getUserFile(user.id, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getUserFileContent(user.id, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime, true);
});

route('GET', '/myfile/:owner_id/:file_id/download', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const owner = params.owner_id;
    const f = storage.getUserFile(owner, params.file_id);
    if (!f) return render404(res);
    if (f.visibility !== 'public' && String(owner) !== String(user.id)) {
        return render403(res, '该文件未公开');
    }
    const buf = storage.getUserFileContent(owner, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime, true);
});

route('GET', '/myfile/:owner_id/:file_id', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const owner = params.owner_id;
    const f = storage.getUserFile(owner, params.file_id);
    if (!f) return render404(res);
    if (f.visibility !== 'public' && String(owner) !== String(user.id)) {
        return render403(res, '该文件未公开');
    }
    const buf = storage.getUserFileContent(owner, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime);
});

route('GET', '/myfile/:file_id', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    const f = storage.getUserFile(user.id, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getUserFileContent(user.id, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime);
});

route('POST', '/myfile/:file_id/delete', ({ res, user, params }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    storage.deleteUserFile(user.id, params.file_id);
    redirect(res, '/myfile?ok=' + encodeURIComponent('文件已删除'));
});

route('POST', '/myfile/:file_id/rename', ({ res, user, params, form }) => {
    if (!user || !user.id) throw new UnauthorizedError();
    try {
        const meta = storage.renameUserFile(user.id, params.file_id, form.filename || '');
        require('./_helpers').json(res, 200, { ok: true, filename: meta.filename });
    } catch (e) {
        require('./_helpers').json(res, 200, { ok: false, error: e.message });
    }
});

route('POST', '/myfile/:file_id/visibility',
    ({ res, user, params, form }) => {
    const { json } = require('./_helpers');
    if (!user || !user.id) return json(res, 401, { ok: false, error: '未登录' });
    const f = storage.getUserFile(user.id, params.file_id);
    if (!f) return json(res, 404, { ok: false, error: '文件不存在' });
    const v = form.visibility === 'public' ? 'public' : 'private';
    try {
        storage.setUserFileVisibility(user.id, params.file_id, v);
        json(res, 200, { ok: true, visibility: v });
    } catch (e) {
        json(res, 200, { ok: false, error: e.message });
    }
});

// ---------- 域文件 ----------
route('GET', '/domain/:domain_name/files', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!storage.domainExists(dn)) return render404(res);
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'view_file');
    const files = storage.listDomainFiles(dn).map(f => ({
        ...formatFileItem(f),
        is_own: user && f.uploader === user.id,
    }));
    render(res, 'domain_files.html', withSiteName({
        domain_name: dn,
        display_name: storage.loadDomain(dn).display_name || dn,
        current_user: user || {}, nav: buildNav(user, dn),
        files,
        can_upload: hasPerm(du.perm, PERM.UPLOAD_FILE)
            && hasPriv(user, 'file', PRIV.FILE.UPLOAD),
        can_delete_any: hasPerm(du.perm, PERM.DELETE_ANY_FILE)
            && hasPriv(user, 'file', PRIV.FILE.DELETE_ANY),
        max_file_size_mb: (storage.loadDomain('system').system_config || {}).max_file_size_mb || 50,
    }));
});

route('POST', '/domain/:domain_name/files/upload', ({ res, user, params, rawBody, req }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const du = auth.getDomainUser(dn, user);
    try {
        checkDual(user, du, 'upload_file');
    } catch (e) {
        return require('./_helpers').json(res, e.status || 403, { ok: false, error: e.message });
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
    checkDual(user, du, 'view_file');
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getDomainFileContent(dn, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime, true);
});

route('GET', '/domain/:domain_name/files/:file_id', ({ res, user, params }) => {
    const dn = params.domain_name;
    const du = auth.getDomainUser(dn, user);
    checkDual(user, du, 'view_file');
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) return render404(res);
    const buf = storage.getDomainFileContent(dn, f.id);
    if (!buf) return render404(res);
    serveFile(res, buf, f.filename, f.mime);
});

route('POST', '/domain/:domain_name/files/:file_id/delete', ({ res, user, params }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) { res.writeHead(404); res.end(); return; }
    const du = auth.getDomainUser(dn, user);
    const isOwn = f.uploader === user.id;
    checkDual(user, du, 'delete_file', isOwn);
    const canDelete = (isOwn && hasPerm(du.perm, PERM.DELETE_OWN_FILE))
        || hasPerm(du.perm, PERM.DELETE_ANY_FILE);
    if (!canDelete) throw new PrivilegeError('你没有删除此文件的权限');
    storage.deleteDomainFile(dn, f.id);
    redirect(res, `/domain/${dn}/files?ok=` + encodeURIComponent('文件已删除'));
});

route('POST', '/domain/:domain_name/files/:file_id/rename', ({ res, user, params, form }) => {
    const dn = params.domain_name;
    if (!user || !user.id) throw new UnauthorizedError();
    const f = storage.getDomainFile(dn, params.file_id);
    if (!f) return require('./_helpers').json(res, 404, { ok: false, error: '文件不存在' });
    const du = auth.getDomainUser(dn, user);
    const isOwn = f.uploader === user.id;
    checkDual(user, du, 'delete_file', isOwn);
    const canRename = isOwn || hasPerm(du.perm, PERM.DELETE_ANY_FILE);
    if (!canRename) throw new PrivilegeError('无权限');
    try {
        const meta = storage.renameDomainFile(dn, params.file_id, form.filename || '');
        require('./_helpers').json(res, 200, { ok: true, filename: meta.filename });
    } catch (e) {
        require('./_helpers').json(res, 200, { ok: false, error: e.message });
    }
});

(function () {
    'use strict';
    function showError(message) {
        if (window.showAlert) window.showAlert(message);
        else window.alert(message);
    }
    function setBusy(form, busy) {
        var buttons = form.querySelectorAll('button[type="submit"]');
        for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !!busy;
    }
    function readJson(text) {
        try { return JSON.parse(text); }
        catch (e) { throw new Error('服务器返回无效响应'); }
    }
    function decodeBase64(value) {
        var binary = atob(value);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }
    function encodeBase64(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    }
    function utf8Bytes(value) {
        return new TextEncoder().encode(value);
    }
    window.submitEncryptedAuth = function (form) {
        if (!window.nacl || !window.nacl.box) return true;
        if (form.dataset.submitting === '1') return false;
        form.dataset.submitting = '1';
        setBusy(form, true);
        var data = new FormData(form);
        var fields = {};
        data.forEach(function (value, key) {
            if (typeof value === 'string') fields[key] = value;
        });
        var action = form.getAttribute('action') || location.href;
        fetch('/api/auth/public-key', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        }).then(function (res) {
            return res.json();
        }).then(function (info) {
            if (!info || !info.ok || !info.public_key) {
                throw new Error('无法获取加密公钥');
            }
            var serverKey = decodeBase64(info.public_key);
            var clientKeys = window.nacl.box.keyPair();
            var nonce = window.nacl.randomBytes(window.nacl.box.nonceLength);
            var message = utf8Bytes(JSON.stringify(fields));
            var ciphertext = window.nacl.box(
                message, nonce, serverKey, clientKeys.secretKey);
            if (!ciphertext) throw new Error('凭据加密失败');
            var body = JSON.stringify({
                v: 1,
                alg: 'curve25519-xsalsa20-poly1305',
                client_public_key: encodeBase64(clientKeys.publicKey),
                nonce: encodeBase64(nonce),
                ciphertext: encodeBase64(ciphertext),
            });
            return fetch(action, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: body,
            });
        }).then(function (res) {
            return res.text().then(function (text) {
                var result = readJson(text);
                if (!result.ok) throw new Error(result.error || '操作失败');
                location.href = result.redirect || '/';
            });
        }).catch(function (err) {
            showError(err && err.message ? err.message : '网络错误，请稍后重试');
        }).then(function () {
            delete form.dataset.submitting;
            setBusy(form, false);
        });
        return false;
    };
})();

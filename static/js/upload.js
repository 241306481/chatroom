window.initUpload = function (opts) {
    var MAX_MB = opts.maxMb || 50;
    var MAX_BYTES = MAX_MB * 1024 * 1024;
    var input = document.getElementById(opts.inputId);
    if (!input) return;
    var progressBox = document.getElementById('uploadProgress');
    var progressFill = document.getElementById('progressFill');
    var progressPercent = document.getElementById('progressPercent');
    var progressFilename = document.getElementById('progressFilename');
    var progressQueue = document.getElementById('progressQueue');
    input.addEventListener('change', function () {
        var allFiles = Array.from(this.files);
        if (allFiles.length === 0) return;
        progressBox.style.display = 'block';
        progressQueue.innerHTML = '';
        var accepted = [], rejected = [];
        allFiles.forEach(function (f) {
            var row = document.createElement('div');
            row.className = 'progress-queue-item';
            row.dataset.name = f.name;
            if (f.size > MAX_BYTES) {
                row.innerHTML = '<span>' + esc(f.name) + '</span>' +
                    '<span class="queue-status" style="color:#ff4d4f;">❌ 超过 ' + MAX_MB + ' MB（' + humanSize(f.size) + '）</span>';
                rejected.push(f);
            } else {
                row.innerHTML = '<span>' + esc(f.name) + '</span><span class="queue-status">等待</span>';
                accepted.push(f);
            }
            progressQueue.appendChild(row);
        });
        if (accepted.length === 0) {
            progressFilename.textContent = '全部文件超限，已取消';
            progressPercent.textContent = '—';
            this.value = '';
            return;
        }
        if (rejected.length > 0) {
            progressFilename.textContent = rejected.length + ' 个文件超限已跳过，上传其余 ' + accepted.length + ' 个';
        }
        failedCount = 0;
        uploadSequential(accepted, 0);
        this.value = '';
    });
    var failedCount = 0;
    function finishAll(files) {
        var okCount = files.length - failedCount;
        if (failedCount > 0) {
            progressFilename.textContent = '完成 ' + okCount + '/' + files.length + '，' + failedCount + ' 个失败';
            progressPercent.textContent = Math.round(okCount / files.length * 100) + '%';
            progressFill.style.width = (okCount / files.length * 100) + '%';
            window.showAlert(failedCount + ' 个文件上传失败，详见下方队列');
            if (okCount > 0) setTimeout(function () { location.reload(); }, 1500);
            return;
        }
        progressFilename.textContent = '全部上传完成';
        progressPercent.textContent = '100%';
        progressFill.style.width = '100%';
        setTimeout(function () { location.reload(); }, 800);
    }
    function uploadSequential(files, index) {
        if (index >= files.length) {
            finishAll(files);
            return;
        }
        var f = files[index];
        progressFilename.textContent = '上传中：' + f.name + ' (' + (index + 1) + '/' + files.length + ')';
        var queueItem = progressQueue.querySelector('[data-name="' + CSS.escape(f.name) + '"]');
        if (queueItem) queueItem.querySelector('.queue-status').textContent = '上传中';
        var fd = new FormData();
        fd.append('file', f);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', opts.uploadUrl);
        xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
                var pct = (e.loaded / e.total * 100).toFixed(1);
                progressFill.style.width = pct + '%';
                progressPercent.textContent = pct + '%';
            }
        };
        xhr.onload = function () {
            var ok = false;
            try {
                var res = JSON.parse(xhr.responseText);
                ok = !!res.ok;
                if (res.ok) { if (queueItem) queueItem.querySelector('.queue-status').textContent = '✅'; }
                else if (queueItem) queueItem.querySelector('.queue-status').textContent = '❌ ' + (res.error || '失败');
            } catch (e) { if (queueItem) queueItem.querySelector('.queue-status').textContent = '❌ 响应异常'; }
            if (!ok) failedCount++;
            uploadSequential(files, index + 1);
        };
        xhr.onerror = function () {
            failedCount++;
            if (queueItem) queueItem.querySelector('.queue-status').textContent = '❌ 网络错误';
            uploadSequential(files, index + 1);
        };
        xhr.send(fd);
    }
    function humanSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }
};

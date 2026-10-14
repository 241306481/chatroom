# 贡献指南

## 提交前必跑

```bash
npm test          # 编码守卫 + 全部回归套件
node --check <改动的 .js 文件>
```

`npm test` 的第一道关是编码守卫（`scripts/check-encoding.js`），任何源码里出现
UTF-8 BOM 或 U+FFFD 替换字符都会直接失败并列出文件与行号。

---

## 文件读写约束

> 这一节是血的教训，不是形式主义。请完整读完再改含中文的文件。

### 禁止

**禁止**使用 PowerShell 的 `Get-Content` / `Set-Content` / `-replace` / `Out-File`
处理含中文的源文件（会因 GBK/UTF-8 不匹配损坏内容）。

原因：Windows PowerShell 5.1 的 `Get-Content` 默认按系统 ANSI 代码页（本机为
GBK）解码，而源文件是 UTF-8。读进来的已经是乱码，再 `Set-Content` 写回去时又
被按 UTF-8 编码，乱码就此固化——而且 `Set-Content -Encoding UTF8` 还会额外
塞一个 BOM。

这种损坏有三个特点，让它格外危险：

1. **语法完全合法**，`node --check` 过得去；
2. **测试常常全绿**，因为被改坏的通常是注释和文案，不是逻辑；
3. **肉眼看终端往往「好像没问题」**——乱码经过终端代码页二次渲染后，
   有时能凑出可读的假象。

真实案例：上一轮用 `Get-Content -Raw` + `-replace` 批量重命名 `lib/routes/auth.js`
里的函数，整个文件的中文注释被写坏，还多了一个 BOM。是逐字节检查才发现的，
而不是 `git diff`。

### 必须

修改含中文的文件时，**必须**使用以下方式之一：

- **Node.js 的 fs API**（最可靠，跨平台一致）：
  ```js
  const s = fs.readFileSync(p, 'utf8');
  fs.writeFileSync(p, s.replace(oldStr, newStr), 'utf8');
  ```
  批量替换建议写成临时 `.js` 脚本执行，不要塞进 `node -e "..."`——
  PowerShell 对内联引号的转义同样会制造难以排查的坑。
- **编辑器 / IDE 自带的编辑 API**（单文件定位替换最稳）。
- **命令行工具的 `--encoding utf8` 参数**（如支持），例如
  ```powershell
  Get-Content -Encoding UTF8
  Get-Content -Raw -Encoding UTF8
  ```
  注意：`-Encoding` 必须**读取和写入两端都加上**，只加一边一样会损坏。

### 校验

改完含中文的文件后，跑一次：

```bash
node scripts/check-encoding.js
```

它会扫描 `lib/`、`test/`、`scripts/`、`static/js/` 下的所有 `.js`，
报告 BOM、非法 UTF-8 字节、U+FFFD 三类问题，并指出行号。

---

## 其它约定

- 注释用中文，与现有代码保持一致。
- 不要提交 `data/`、`logs/`、`cert.pem`、`key.pem`。
- 新增回归用例放 `test/r-*.test.js`，并在 `scripts/test.js` 的 `SUITES` 里登记。
- 合并重复实现时，务必确认所有调用点都已切换到新位置，并加一条断言
  「旧位置不再保留副本」，否则两份定义迟早分叉。
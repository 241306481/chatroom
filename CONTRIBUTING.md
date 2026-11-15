# 贡献指南

先读 [README.md](README.md) 了解项目结构、启动方式与权限模型；本指南只列改动时必须遵守的约束。

## 提交前检查

```bash
node --check <改动的 .js 文件>
node test/check-encoding.js
npm test
```

PowerShell 如果提示无法加载 `npm.ps1`，改用 `npm.cmd test`。

提交前确认：

- [ ] 改动过的 `.js` 文件通过 `node --check`
- [ ] 编码检查通过
- [ ] `npm test` 全部通过
- [ ] 新增或修改的页面在浅色、深色和窄屏下显示正常
- [ ] 用户可见行为变化已同步 README、`templates/help.html` 和回归测试
- [ ] 未提交 `data/`、`logs/`、`cert.pem`、`key.pem` 或临时脚本

`npm test` 会先运行编码守卫，再执行 `test/test.js` 中登记的回归套件。编码守卫会报告 BOM、非法 UTF-8 字节和 U+FFFD 替换字符。

> **`npm test` 会清空 `data/`、`logs/`、`cert.pem` 和 `key.pem`。** 不要在有真实数据的环境运行；先备份，或在独立临时目录中测试。

---

## 模板与前端约定

- **页面继承基础模板**：普通页面继承 `templates/base.html`，登录/注册/错误页继承
  `templates/base_simple.html`。版权栏由 `templates/_footer.html` 统一引入，
  不要在页面里复制一份页脚。
- **版权栏信息不要硬编码**：版本、年份、许可证和仓库地址分别来自
  `app_version`、`app_year`、`app_license`、`app_repo_url`，由 `lib/template.js`
  从 `package.json` 注入。发布新版本时只改 `package.json` 的 `version`。
- **CSP**：不要新增内联 `onclick` / `onchange` 等事件属性。需要内联脚本时加
  `nonce="{{ csp_nonce }}"`；优先把逻辑放进 `static/js/`，用事件委托绑定。
- **转义**：Nunjucks 默认自动转义，不要随意使用 `| safe`；传给脚本的数据用
  `| jsdump`，不要把用户内容直接拼进 `<script>`。
- **前端无构建步骤**：保持原生 JS / CSS，不引入打包器或框架。新增 CSS 文件必须
  在 `static/css/main.css` 中 `@import`，并同时提供深色主题样式。
- **响应式与可访问性**：交互控件要有可见的 `:focus-visible` 样式和 `aria-label`；
  改动布局时检查 720px 以下的窄屏，以及讨论页/私信页的全高布局是否仍能容纳页脚。
- **接口返回**：POST 成功和失败都返回 JSON（`{ ok: true/false, ... }`），
  页面端用 `showAlert` / `showConfirm` / `showToast`，不要新增原生 `alert/confirm`。
- **WebSocket**：发送结构化数据，不要把服务端渲染好的 HTML 塞进消息；成员列表等
  高频更新走增量 DOM，避免整块 `innerHTML` 替换。

---

## 文件读写约束

修改含中文的源文件时，必须使用 Node.js `fs` API、编辑器编辑 API，或显式指定 UTF-8 的读写工具。不要使用 PowerShell 的 `Get-Content` / `Set-Content` / `-replace` / `Out-File`：未指定编码时它们按系统 ANSI 代码页处理，可能损坏 UTF-8 内容。

推荐使用 Node.js：

```js
const s = fs.readFileSync(p, 'utf8');
fs.writeFileSync(p, s.replace(oldStr, newStr), 'utf8');
```

批量替换写成临时 `.js` 脚本执行，不要塞进 `node -e "..."`，避免 shell 引号转义问题。

修改后运行：

```bash
node test/check-encoding.js
```

该检查扫描 `lib/`、`test/`、`static/js/` 下的 `.js`，报告 BOM、非法 UTF-8 字节和 U+FFFD 替换字符，并给出行号。

---

## CSS 注释约束

CSS 只支持 `/* ... */` 注释，不支持 `//`。在 `@import` 清单里使用 `//` 会导致后续 `@import` 失效；注释也不能嵌套，注释体内出现 `/*` 会提前结束注释。回归套件会检查这两条。

---

## 数据与测试约定

- 测试必须使用独立的临时数据目录或接受 `npm test` 会清空 `data/` 的事实；
  不要在有真实数据的环境里直接跑测试。
- 新增回归套件命名为 `test/item/*-test.js`，并在 `test/test.js` 的 `SUITES` 里登记。
- 测试代码一律放 `test/`，不要在别处散落临时脚本；路径用
  `path.join(__dirname, ...)` 推导，不要硬编码绝对路径。
- 新增数据字段时考虑旧数据兼容；读取缺失字段要回退到默认值，不要假设所有
  历史 JSON 都已迁移。
- 修改存储格式、权限位或 WebSocket 消息结构时，必须同时更新相关回归断言和
  文档，避免只改一端。

## 文档与版权

- 用户可见功能变化要同步更新 `README.md` 和 `templates/help.html`。
- 新增页面或布局时确认页脚版权栏存在，且版本信息仍来自 `package.json`。
- 派生发行请修改 `package.json` 的 `name`、`version`、`author`、`repository`，
  保留 `LICENSE`、`NOTICE` 和页脚署名；不要移除或遮挡版权信息。
- 文档中的命令、环境变量、路径必须与代码一致；不确定的示例不要写进文档。

---

## 许可证要求（Apache-2.0）

本项目按 **Apache License 2.0** 发布。`LICENSE` 是许可证全文，`NOTICE` 是归属声明，
两者都必须保留原样。提交改动时请遵守下面几条。

### 提交时必须做

- **保留 `LICENSE` 和 `NOTICE`**：不要删除、改名或挪到别处，也不要替换成别的许可证。
- **不要改动 `LICENSE` 内容**：它是许可证原文，一个字都不能改。
- **不要删 `NOTICE` 里的归属信息**：`NOTICE` 里对原项目的署名和仓库链接必须保留。
- **在 `package.json` 里保留 `license`、`author`、`repository` 字段**：发布到 npm 时
  这几个字段会进包元数据，删掉会影响下游的许可证识别。
- **不要给单个源文件加版权头**：Apache-2.0 不要求逐文件标注，
  项目统一在 `LICENSE` + `NOTICE` 声明就够了。

### 派生发行 / 二次分发时

- 分发源码或二进制都要**附带 `LICENSE` 全文**。
- **显著保留原项目的署名**（作者、来源仓库链接），并在改动说明里注明。
- **注明你做了哪些修改**：这是 Apache-2.0 第 4(b) 条的要求。
- 如果你的发行物里含有第三方代码，也要保留那部分代码的许可证和归属声明。

### 不要做的事

- 不要把 Apache-2.0 换成 MIT / GPL 等其它许可证。
- 不要在 `NOTICE` 之外宣称「本项目采用某某协议」而与 `LICENSE` 矛盾。

### 常见问题

**Q: 我只想改个错别字，也需要遵守这些吗？**
A: 需要。「注明改动」是针对**发行**的要求，不是要求你在每次 PR 里写变更日志。
仓库本身通过 git 历史记录改动就够了。

**Q: 能不能把 `NOTICE` 里的作者名改成我自己的？**
A: 不能。`NOTICE` 记录的是**原项目**的归属，你的署名写在你的发行物里，
两者是并列关系，不是替换关系。

**Q: 内部使用、不对外分发，还要管这些吗？**
A: 建议保留，避免后续分发时再补。

---

## 其它约定

- 注释用中文，与现有代码保持一致。
- 合并重复实现时，确认所有调用点都已切换到新位置，并加一条断言「旧位置不再保留副本」。
- 修改公共函数签名时，先搜索全部调用点；不要只改当前页面能跑到的路径。
- 发现文档、注释或测试与实现不一致时，优先修正错误，而不是增加兼容代码掩盖问题。

## 文档维护

新增约定或发现规则过时时，请在同一个 PR 中更新本文件。

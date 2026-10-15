# Chatroom

一个用 Node.js 原生 HTTP + WebSocket 实现的聊天室服务端。数据全部落在本地 JSON 文件里，不依赖数据库。

## 特性

- **域 / 讨论**：按域组织，每个域下有多个讨论区，支持置顶、改名、删除
- **私信**：用户之间一对一会话，支持附件、未读计数
- **文件**：用户空间（我的文件）与域空间两套，均支持可见性控制
- **角色与权限**：38 项权限，分基础 / 系统 / 讨论 / 消息 / 文件 / 成员 / 域设置七组；域与系统各有一套内置角色
- **双重校验**：部分操作要求同时具备系统权限与域内权限（`dual-check`）
- **管理面板**：用户、域、角色、权限、封禁、系统设置
- **命令行控制台**：不启服务也能直接管数据
- **HTTPS**：生成自签证书后自动切换 HTTPS / WSS

## 环境要求

- Node.js 18 或更高（启动自检会校验版本）
- 无需数据库，无需构建步骤

## 快速开始

```bash
npm install
npm start
```

启动后访问 `http://127.0.0.1:5000`。

**第一个注册的用户会自动成为超级管理员。** 注册完先去 `/manage` 改掉默认设置，并尽快给自己换个密码。

### 局域网 / 手机访问

服务默认监听 `0.0.0.0`，启动日志会打印局域网地址：

```
  Local   : http://127.0.0.1:5000
  LAN URL : http://192.168.x.x:5000
```

同一 Wi-Fi 下的其它设备直接用 LAN URL 即可。

## 命令

| 命令 | 作用 |
|---|---|
| `npm start` | 启动服务 |
| `npm test` | 编码守卫 + 全部回归套件 |
| `npm run cert` | 生成自签证书（`cert.pem` / `key.pem`），之后启动自动走 HTTPS |
| `npm run console` | 进入命令行管理控制台 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `5000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `TRUST_PROXY` | 未设置 | 设为 `1` 时信任 `X-Forwarded-For`；**只在确实跑在反向代理后面时才开**，否则客户端可伪造 IP |
| `LOG_MAX_BYTES` | 无上限 | 单个日志文件大小上限，超过后按天轮转；不设则只按天轮转 |
| `NO_COLOR` | — | 禁用控制台彩色输出 |

## HTTPS

```bash
npm run cert
npm start
```

`npm run cert` 会自动探测系统里的 `openssl`（含 Git for Windows 自带的那份），生成证书后打印指纹、SAN、到期时间以及各平台的信任导入步骤。

`cert.pem` 和 `key.pem` 不会进版本库。只要它们存在于项目根目录，服务就以 HTTPS / WSS 启动；删掉即回到明文。

## 数据存放

```
data/
├── users/<uid>/
│   ├── config.json          账号配置
│   ├── files/ + files.json  用户空间文件
│   ├── messages/            私信会话
│   ├── ips.json             最近登录 IP（保留 10 条）
│   ├── following.json / followers.json / blocked.json
│   └── unread.json / conversations.json
├── domains/<name>/
│   ├── config.json          域配置（成员、角色、加入策略）
│   ├── files/ + files.json  域空间文件
│   └── discuss/<disc>/
│       ├── config.json      讨论配置
│       └── messages/chunk-0001.json …   消息分片
├── uid_counter.json
└── nickname_index.json
```

`data/` 与 `logs/` 均在 `.gitignore` 中，不进版本库。

## 权限模型

权限分七组，共 38 项：

| 组 | 项数 | 覆盖范围 |
|---|---|---|
| 基础 | 6 | 账号资料、创建域、查看所有域、发送私信、用户空间上传、全局提及 |
| 系统 | 5 | 访问系统管理、编辑系统设置、管理全局用户、管理所有域、超级管理员 |
| 讨论 | 7 | 查看、创建、编辑（任意 / 自己的）、删除（任意 / 自己的）、置顶 |
| 消息 | 8 | 发送、表情回应、编辑、删除、撤回（自己的 / 任意的）、置顶 |
| 文件 | 4 | 查看、上传（域空间）、删除（自己的 / 任意的） |
| 成员 | 4 | 禁言、踢出、管理域成员、管理域角色 |
| 域设置 | 4 | 编辑域设置、管理加入方式、转让所有权、删除域 |

其中 27 项标记为「双重校验」，需要系统侧与域内同时授予才生效。

**内置角色**

- 域：`guest`（访客）、`default`（默认成员）、`root`（域主）
- 系统：`guest`、`member`、`admin`、`root`

部分权限标记为「双重校验」，需要系统侧与域内同时授予才生效。

## 命令行控制台

不启服务也能直接操作数据，适合排查与批量维护：

```bash
npm run console
```

覆盖用户、域、讨论、私信、文件、封禁、系统角色、经验、会话等对象。输入 `help` 查看完整命令列表。

## 测试

```bash
npm test
```

第一道关是编码守卫，扫描全部源码里的 BOM、非法 UTF-8 字节和 U+FFFD 替换字符——中文被写坏时语法检查和功能测试往往都还是绿的，只有这一关能拦下来。

其后是 11 个回归套件（183 项），每个用例独立进程、独立数据目录：

| 套件 | 覆盖 |
|---|---|
| `guard-test.js` | 特权收窄、编码守卫、关停、限流、自检、npm audit |
| `permission-test.js` | 权限判定、置顶约束、WS 权限闸门 |
| `exp-test.js` | 经验立即落盘、等级曲线 |
| `editor-test.js` | 编辑器、提及、上传 |
| `auth-test.js` | 注册登录、会话、封禁、重定向 |
| `route-safety-test.js` | 管理路由的三态鉴权（允许 / 拒绝 / 未登录） |
| `tls-test.js` | 证书生成、HTTPS 启动 |
| `console-test.js` | 控制台入口与启动器 |
| `console-cmds-test.js` | 各控制台命令 |
| `css-split-test.js` | CSS 合法性（注释语法、括号配对、`@import` 断链） |
| `log-test.js` | 日志产出与轮转 |

## 启动自检

每次启动都会跑一轮检查并打印结果：Node 版本、数据目录可读可写、磁盘剩余空间、`users` / `domains` 子目录、系统域与系统账户是否就绪、JSON 文件完整性、系统时区、端口是否可用、证书有效期、`TRUST_PROXY` 配置。

任一项不通过会直接拒绝启动，而不是带着隐患跑起来。

## 优雅关闭

收到 `SIGINT` / `SIGTERM` 后：停止接受新连接 → 通知在线客户端断开（WS 关闭码 1001）→ 等待 500ms 宽限 → 强制关闭剩余连接 → 落盘日志 → 退出。超过 8 秒未退出会强制结束。

## 项目结构

```
server.js              入口：启动自检 → HTTP → WebSocket → 优雅关闭
lib/
├── auth/              账号、会话、经验、封禁、限流、特权判定
├── console/           命令行控制台（命令 + 帮助）
├── permissions/       权限定义、角色、双重校验
├── routes/            HTTP 路由（页面 + 管理面板）
├── storage/           JSON 文件存储
├── websocket/         讨论 / 私信 / 状态频道
├── template.js        nunjucks 渲染
├── logger.js          日志与轮转
└── startup-check.js   启动自检
static/                前端资源（js / css）
templates/             页面模板
test/
├── test.js            回归入口
├── check-encoding.js  编码守卫
├── item/              各回归套件
└── tools/gen-cert.js  自签证书生成
```

WebSocket 端点：

| 路径 | 用途 |
|---|---|
| `/ws/discuss/:domain/:disc` | 讨论频道 |
| `/ws/dm` | 私信 |
| `/ws/status/:domain` | 在线状态 |

## 开发约定

改动前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)，那里有几条踩过坑之后定下的硬约束（尤其是文件读写与 CSS 注释）。

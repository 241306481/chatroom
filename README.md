# Chatroom

一个用 Node.js 原生 HTTP + WebSocket 实现的聊天室服务端。元数据保存在本地 JSON 文件里，附件按文件存储，不依赖数据库。

## 特性

- **域 / 讨论**：按域组织，每个域下有多个讨论区，支持置顶、改名、删除
- **私信**：用户之间一对一会话，支持附件、未读计数
- **文件**：用户空间（我的文件）与域空间两套；用户文件支持可见性控制，域文件按域权限访问
- **Markdown**：消息与编辑器支持代码块多语言高亮
- **角色与权限**：44 项权限，分基础 / 系统 / 讨论 / 消息 / 文件 / 域成员 / 域管理七组；域与系统各有一套内置角色
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

**第一个注册的用户会自动成为超级管理员。** 注册后请到 `/manage` 检查系统设置并修改密码。

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
| `CHATROOM_DATA_DIR` | `./data` | 数据存放位置，可指向独立磁盘或临时目录 |
| `TRUST_PROXY` | 未设置 | 设为 `1` 时信任 `X-Forwarded-For`；**只在确实跑在反向代理后面时才开**，否则客户端可伪造 IP |
| `LOG_MAX_BYTES` | 无上限 | 单个日志文件大小上限，超过后按天轮转；不设则只按天轮转 |
| `NO_COLOR` | — | 禁用控制台彩色输出 |
| `CHATROOM_BACKUP_DIR` | 未设置 | 自动备份目录；设为目录后生成 `.tar.gz` 历史包，关闭服务时也会备份 |
| `CHATROOM_BACKUP_MAX` | `10` | 保留的历史备份包数量 |
| `CHATROOM_BACKUP_TIME` | `60` | 定时备份间隔（分钟），设为 `0` 仅关闭时备份 |

备份包为 `data-*.tar.gz`，解压到项目根目录即可恢复。

## HTTPS

```bash
npm run cert
npm start
```

`npm run cert` 会自动探测系统里的 `openssl`（含 Git for Windows 自带的那份），生成证书后打印指纹、SAN、到期时间以及各平台的信任导入步骤。

`cert.pem` 和 `key.pem` 不会进版本库；只要它们存在于项目根目录，服务就以 HTTPS / WSS 启动，否则使用 HTTP。

## 反向代理

`npm run cert` 生成的是**自签证书**，浏览器会红色警告、必须手动点「继续访问」。正式部署通常在服务前面加一层 Nginx / Caddy，由它持有受信任 CA 签发的证书。

```
浏览器 ──HTTPS──> Nginx ──HTTP──> 本服务 (:5000)
```

好处是证书正规、浏览器不报警、可开 HTTP/2，静态文件也能交给反代直接返回。

### 必开 TRUST_PROXY

反代之后，服务看到的 `remoteAddress` 永远是 `127.0.0.1`（反代自己），拿不到真实访客 IP。后果是 IP 封禁失效、`/manage/user_ips` 里全是 `127.0.0.1`、登录限流的 IP 维度形同虚设。

反代会把真实 IP 写进请求头，服务据此还原：

```bash
set TRUST_PROXY=1
set PORT=5000
node server.js
```

`TRUST_PROXY` 接受 `1` / `true` / `yes` / `on`（不区分大小写）。

> **只在确实跑在反向代理后面时才开。** 开启后服务会采信请求头里的 IP，任何人都能自行伪造，封禁与审计日志随之全部失效。

读取顺序为 `X-Forwarded-For` 的**第一个**值 → `X-Real-IP` → 都没有才退回 socket 地址。所以反代必须覆盖（而非追加）这两个头，否则客户端可以在自己的 XFF 前面塞假 IP。

### Nginx 配置

WebSocket 需要额外转发 Upgrade 头，否则 `wss://` 连不上：

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # WebSocket 升级
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 真实 IP 与原始协议，两者都不可少
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$host$request_uri;
}
```

`X-Forwarded-Proto` 决定 Cookie 是否带 `Secure`（`isSecureRequest` 只在 `TRUST_PROXY` 开启时才读这个头），漏了会导致 HTTPS 下 Cookie 属性不正确。

反代终止 TLS 后，后端保持明文即可——此时**不要**在项目根目录留 `cert.pem` / `key.pem`，否则服务会以 HTTPS 启动，反代再用 HTTP 回连就会握手失败。

## 数据存放

```
data/
├── users/<uid>/
│   ├── config.json          账号配置
│   ├── files/ + files.json  用户空间文件
│   ├── messages/            私信会话
│   ├── ips.json             最近登录 IP（保留 10 条）
│   ├── following.json / followers.json / blocked.json / blocked_by.json
│   └── unread.json / conversations.json
├── domains/<name>/
│   ├── config.json          域配置（成员、角色、加入策略）
│   ├── files/ + files.json  域空间文件
│   └── discuss/<disc>/
│       ├── config.json      讨论配置
│       └── messages/chunk-00001.jsonl …   消息分片
├── uid_counter.json
└── nickname_index.json
```

`data/` 与 `logs/` 均在 `.gitignore` 中，不进版本库。

## 权限模型

权限分七组，共 44 项：基础 7、系统 9、讨论 7、消息 8、文件 4、域成员 5、域管理 4。其中 27 项为「双重校验」，需要系统侧与域内同时授予才生效。

**内置角色**

- 域：`guest`（访客）、`default`（默认成员）、`root`（域主）
- 系统：`guest`、`member`、`admin`、`root`

## 命令行控制台

不启服务也能直接操作数据，适合排查与批量维护：

```bash
npm run console
```

覆盖用户、域、讨论、私信、文件、封禁、系统角色、经验、会话等对象。输入 `help` 查看完整命令列表。

### 自检

```bash
check              # 全局自检，逐项列出并给出通过/警告/失败统计
check user         # 只查某一子系统
check avatar       # 头像一致性
check help         # 列出全部可用检查项
check avatar repair # 头像字段与磁盘不一致时以磁盘为准回填
```

覆盖 12 个子系统：`user` `domain` `discuss` `dm` `file` `avatar` `perm` `ip` `ban` `json` `space` `session`。

自检以「数据是否自洽」为主，能发现磁盘与索引脱节、字段指向已删文件、非法到期时间、角色引用不存在等问题——这些在页面上看不出来，只会在用户撞到时才暴露。

另有两处带修复的自检：

```bash
ban repair          # 非法解禁时间归一为永久（封禁与禁言共用同一套修复）
check avatar repair # 头像记录以磁盘为准
```

## 测试

```bash
npm test
```

> ⚠️ **`npm test` 会删掉 `data/` 目录**（含 `data/users/`、`data/domains/`），
> 同时清掉 `logs/`、`cert.pem`、`key.pem`。回归用例需要干净的初始状态。
> **有真实数据时不要直接跑** —— 先备份，或在独立目录里测。

第一道关是编码守卫，扫描源码里的 BOM、非法 UTF-8 字节和 U+FFFD 替换字符——中文被写坏时语法检查和功能测试往往都还是绿的，只有这一关能拦下来。

之后由 `test/test.js` 依次运行 `SUITES` 中登记的 `test/item/*-test.js`；每个套件使用独立进程，并在开始前清空数据目录。新增套件需同步登记。

## 启动自检

每次启动都会跑一轮检查并打印结果：Node 版本、数据目录可读可写、磁盘剩余空间、`users` / `domains` 子目录、系统域与系统账户是否就绪、JSON 文件完整性、系统时区、端口是否可用、证书有效期、`TRUST_PROXY` 配置。

标记为失败的检查会阻止启动；警告项只提示，不影响运行。

## 优雅关闭

收到退出信号后：停止接受新连接 → 通知在线客户端断开（WS 关闭码 1001）→ 必要时等待 500ms 宽限 → 强制关闭剩余连接 → 执行备份（已配置时）→ 落盘日志 → 退出。超过 4 秒未完成会强制结束。

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
├── backup.js          data 自动备份
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

改动前请先读 [CONTRIBUTING.md](CONTRIBUTING.md)，那里有几条踩过坑之后定下的硬约束。

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 241306481. See [NOTICE](NOTICE) for attribution requirements.

## 提示

本文由 AI 生成。
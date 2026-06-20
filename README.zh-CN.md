<p align="center">
  <img src="frontend/src/assets/mebius-loop.png" alt="Mebius Loop——人类与 AI 携手前行" width="100%" />
</p>

<h1 align="center">Mebius Code</h1>

<p align="center"><strong>人类与 AI，携手并肩，共同创造。</strong></p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="http://182.92.150.169/">打开 Web 应用</a> ·
  <a href="https://www.npmjs.com/package/mebius-code">安装 TUI</a> ·
  <a href="https://github.com/AlbertTeslaWizard/Mebius-Code/releases">下载发布版</a>
</p>

Mebius Code 是一个多客户端 Agent 编码平台。NestJS 后端为完整的 Web
工作台、终端原生 TUI 和 Android 伴随客户端提供统一能力，让编码会话可以跟随用户在不同客户端之间延续，同时保留计划、审批和上下文。

## 为什么叫“Mebius”？

**Mebius** 这个名字致意《梦比优斯奥特曼》。这部作品以人类与奥特曼之间的友情和羁绊为核心；选择这个名字，是希望人类与 AI 也能成为携手并肩的伙伴，在共同创造中建立信任，并形成深厚而长久的友情与羁绊。

**梦比优斯光环（Mebius Loop）**还承载着第二层寓意。它的 `∞` 形态象征着：当人类的判断力和创造力与 AI 的能力相互连接、共同前行，双方携手探索的潜力将趋近无穷。

## Mebius Code 能做什么

- **Build 与 Plan 工作流**——既可以直接与编码 Agent 协作，也可以先生成、讨论、修改和审批计划，再开始实现。
- **真实项目工作区**——可在服务端创建项目、导入 Git 仓库或压缩包，也可通过本地运行的后端绑定真实本地路径。
- **代码与 Git 工具**——浏览和编辑文件、预览补丁、执行经授权的命令，并完成常见的 Git 暂存、提交和推送操作。
- **受控自动化**——提供路径沙箱、工具审批、命令策略、会话授权、审计记录和模型凭据加密。
- **可扩展上下文**——支持仓库级 `AGENTS.md` 指令、OpenAI 兼容模型服务、MCP 工具、Web 搜索和 TUI 本地 Skills。
- **多客户端实时会话**——通过统一 API 共享历史消息、SSE 活动和 token 更新、Plan 状态与待处理审批。

## 选择客户端

| 客户端 | 适合场景 | 主要能力 |
| --- | --- | --- |
| [Web](frontend/README.md) | 完整的项目和工作区管理 | 文件树与编辑器、Build/Plan 工作台、模型和命令设置、Git 工作流、审批与审计记录 |
| [TUI](tui/README.md) | 在终端中进行日常编码 | Build/Plan 输入、真实本地路径、MCP 浏览器、Skills、斜杠命令、模型切换与交互式审批 |
| [Android](android/README.md) | 离开电脑后继续跟进任务 | 项目与会话、实时状态、Build/Plan 消息、Plan 审阅，以及单次允许或拒绝工具调用 |

Android 应用的定位是伴随客户端，而不是手机 IDE。模型配置、Git 发布、MCP/Skills 管理和本地工作区绑定仍由 Web 或 TUI 完成。

## 直接体验在线服务

### Web

打开 [Mebius Code Web 应用](http://182.92.150.169/)，注册或登录后，在
**Settings → Models** 中配置模型，然后创建或导入项目。API 地址为
`http://182.92.150.169/api`。

> 当前在线服务使用普通 HTTP。请将其视为公开体验环境：不要复用敏感密码，也不要上传机密源代码。

### TUI

使用 Node.js 18 或更高版本安装 npm 包：

```bash
npm install -g mebius-code
```

Linux、macOS 或 WSL 也可一键安装最新原生版本：

```bash
curl -fsSL https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.ps1 | iex
```

也可以从 [GitHub Releases](https://github.com/AlbertTeslaWizard/Mebius-Code/releases)
手动下载 Windows、Linux 或 macOS 压缩包。安装完成后登录并启动 TUI：

```bash
mebius login --api http://182.92.150.169/api
mebius
```

完整命令说明见 [tui/README.md](tui/README.md)。

公网 API 会在 Mebius 服务器上创建工作区，无法访问你电脑上的
`D:\Code\Python` 或 `/home/me/project` 等路径。需要操作真实本地路径时，请连接本地后端。

### Android

从 [GitHub Releases](https://github.com/AlbertTeslaWizard/Mebius-Code/releases)
下载已签名的 `Mebius-Code-android-x.x.x.apk` 和 `SHA256SUMS`。在 Android
设备上允许所选来源安装应用后安装 APK 并登录。API 地址可以在登录页或设置页修改。

## 本地开发

### 环境要求

- Node.js 18 或更高版本及 npm
- 用于运行 PostgreSQL 的 Docker 与 Docker Compose
- 从源码运行 TUI 时需要 [Bun](https://bun.sh/)
- 构建 Android 应用时需要 JDK 17 和 Android SDK 35

### 后端与 PostgreSQL

```bash
cd backend
npm install
cp .env.example .env
docker compose up -d postgres
npm run start:dev
```

在 PowerShell 中使用 `Copy-Item .env.example .env` 代替 `cp`。API 运行在
`http://localhost:3000/api`。

新用户注册依赖邮箱验证码。请求验证码之前，需要在 `backend/.env` 中配置
`MAIL_ENABLED=true`、`MAIL_FROM`、`SMTP_USER` 和 `SMTP_PASS`。模型 API Key
在登录后配置，并通过 `MEBIUS_CODE_MASTER_KEY` 加密保存。

### Web

先启动后端，再打开另一个终端：

```bash
cd frontend
npm install
npm run dev
```

Vite 应用运行在 `http://127.0.0.1:5173`，并将 `/api` 代理到本地后端。

### TUI 与真实本地路径

如果要让 TUI 绑定电脑上的真实路径，请在启动后端前修改 `backend/.env`：

```env
MEBIUS_CODE_SERVER_MODE=local_runtime
MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true
```

然后连接已经安装的 TUI：

```bash
mebius login --api http://localhost:3000/api
mebius doctor <workspace-path>
mebius <workspace-path>
```

也可以从源码运行：

```bash
cd tui
bun install
bun run start
```

API 切换、本地路径行为、故障排查、快捷键、MCP、Skills 和斜杠命令详见
[tui/README.md](tui/README.md)。

### Android

在 Android Studio 中打开 `android/`，或使用 Gradle Wrapper：

```bash
cd android
./gradlew :app:assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

Windows 使用 `gradlew.bat`。Android 模拟器通过
`http://10.0.2.2:3000/api` 访问宿主机上运行的后端。

### 重置本地数据库

在 `backend/` 目录执行：

```bash
docker compose down -v
```

`-v` 会永久删除本地 PostgreSQL 和后端工作区 Docker volumes。

## 仓库结构

```text
backend/                 NestJS API、Agent 运行时、工具和 PostgreSQL 实体
frontend/                Vue 3 + TypeScript Web 工作台
tui/                     Bun + OpenTUI 终端客户端与 npm 包
android/                 Kotlin + Jetpack Compose Android 伴随客户端
scripts/                 TUI 安装脚本
.github/workflows/       TUI 与 Android 发布自动化
```

产品展示名称使用 **Mebius Code**。工程标识使用 `mebius-code`、
`mebius_code` 和 `MEBIUS_CODE_` 等形式。

## 详细文档

- [后端配置、API、Web 搜索和安全默认值](backend/README.md)
- [Web 本地开发与质量检查](frontend/README.md)
- [TUI 安装、配置、命令与快捷键](tui/README.md)
- [Android 功能范围、构建与发布流程](android/README.md)

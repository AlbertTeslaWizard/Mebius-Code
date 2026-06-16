# Mebius Code

语言：[English](README.md) | **简体中文**

Mebius Code 是一个多客户端 Agent 编码平台。它提供后端服务，用于模型配置、项目工作区、编码会话、Plan Mode、工具审批和服务端代码操作。

产品展示名称为 **Mebius Code**。工程标识使用小写名称，例如 `mebius-code`、`mebius_code` 和 `MEBIUS_CODE_`。

## 项目结构

```text
backend/                 NestJS 后端服务
frontend/                Vue 3 + TypeScript Web 工作台
tui/                     Bun + OpenTUI 终端工作台
android/                 Kotlin + Jetpack Compose Android 伴随客户端
docs/                    项目需求、设计和管理文档
```

## 后端快速开始

```bash
cd backend
npm install
cp .env.example .env
docker compose up -d postgres
npm run start:dev
```

API base URL：

```text
http://localhost:3000/api
```

注册邮箱验证码依赖 SMTP。若使用 Brevo 免费 SMTP relay，需要先创建 transactional sender 和 SMTP key，然后在 `backend/.env` 中配置 `MAIL_ENABLED=true`、`MAIL_FROM`、`SMTP_USER` 和 `SMTP_PASS`。

SSE 会话事件：

```text
GET /api/sessions/:id/events?access_token=<jwt>
```

## 前端快速开始

```bash
cd frontend
npm install
npm run dev
```

Web 应用运行在 `http://127.0.0.1:5173`，并将 `/api` 代理到后端。

可以从工作区的 **Runs** 标签页请求 Shell 命令。每条命令都需要在执行前审批。管理员可以在 **Settings > Command permissions** 中管理 Git、Node.js、Python 和自定义命令权限。

Mebius Code 会读取项目根目录的 `AGENTS.md` 作为仓库级 Agent 指令。在 TUI 中可以运行 `/init` 生成初始文件。

## TUI 快速开始

TUI 连接已经运行的后端 API。MVP 阶段它不会自动启动后端。发布版默认连接公网 API：

```text
http://182.92.150.169/api
```

可以使用以下任一方式安装发布版 TUI：

```bash
npm install -g mebius-code
```

```bash
curl -fsSL https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.ps1 | iex
```

本地开发：

```bash
cd tui
bun install
bun run start
```

安装后的 CLI 命令是 `mebius`。运行 `mebius login` 登录公网 API；如果使用本地后端，运行 `mebius login --api http://localhost:3000/api` 持久保存凭据和 API 配置。

更多 TUI 命令和快捷键见 [tui/README.md](tui/README.md)。

## Android 快速开始

Android 应用是连接已有 Mebius API 实例的轻量伴随客户端。它支持项目/会话浏览、Build 和 Plan 消息、SSE 状态更新，以及一次性批准或拒绝工具调用。

可以在 Android Studio 中打开 `android/`，也可以在本地 Android Gradle 环境中运行：

```bash
gradle :app:assembleDebug
```

Debug 构建默认连接 `http://10.0.2.2:3000/api`；release APK 默认连接 `http://182.92.150.169/api`。API 地址仍可在登录页和设置页修改。APK 通过 GitHub Releases 发布，可以不经过应用市场上架直接安装。

# Mebius Code 系统设计文档

## 1. 技术选型

| 层次 | 技术 | 设计理由 |
| --- | --- | --- |
| 后端框架 | NestJS + TypeScript | 使用类、装饰器、依赖注入、模块和服务组织业务逻辑，适合面向对象课程设计表达 |
| 前端框架 | Vue 3 + TypeScript + Vite | 构建单页 Web 客户端，类型约束明确，开发和演示成本低 |
| TUI 客户端 | Bun + TypeScript + OpenTUI + Solid + unified-latex | 构建可在终端中运行的第二客户端，复用同一套 NestJS API、SSE、审批和工作区能力，并将常见 LaTeX 公式转换为终端可读文本 |
| Android 客户端 | Kotlin + Jetpack Compose + Retrofit + OkHttp SSE + WebView/KaTeX | 构建轻量移动伴随客户端，复用认证、会话、Plan、审批和 SSE 能力，并通过随包本地 KaTeX 资源渲染数学公式 |
| 状态管理 | Pinia | 将认证、工作区、审批、本地化、主题偏好等客户端状态模块化 |
| UI 与编辑 | Naive UI、Tailwind CSS、CodeMirror、Shiki、Markdown-it、markdown-it-texmath、KaTeX、DOMPurify | 支持工作台界面、明暗主题、代码编辑、代码高亮、Markdown/数学公式消息和安全渲染 |
| 数据库 | PostgreSQL | 保存用户、模型配置、项目、会话、消息、计划、审批和审计记录 |
| ORM | TypeORM | 以实体类映射数据库表，便于表达领域对象关系 |
| 认证 | JWT + Passport | 支持 Web 客户端无状态访问受保护接口 |
| 实时事件 | Server-Sent Events | 将模型 token、工具状态、审批、命令输出等事件推送到 Web、TUI 和 Android 客户端 |
| 模型接入 | OpenAI-compatible Chat Completions API | 兼容多个模型 Provider 和工具调用协议 |
| 外部工具接入 | MCP Streamable HTTP、Exa/Tavily Web Search | 动态接入远程文档和公共 Web 检索工具，并将外部内容作为不可信上下文注入 Agent |
| 邮件服务 | Nodemailer + SMTP | 发送注册邮箱验证码，支持课程演示环境按需开启邮件投递 |
| 部署 | Docker Compose | 本地和服务器演示环境都能快速启动 PostgreSQL 与 API 服务 |

## 2. 总体架构

系统采用“前后端分离 + 模块化单体后端 + 多客户端”的架构。后端当前是一个 NestJS 应用，但模块边界按照未来微服务拆分方向设计；Web 前端是 Vue 单页应用，TUI 是 Bun/OpenTUI 终端客户端，Android 是 Kotlin/Compose 伴随客户端，三类客户端都通过 REST API 和 SSE 与后端通信。

```text
Browser Web App
  ├── Auth / Workspace / Settings Views
  ├── Pinia Stores
  └── REST + SSE Client

Terminal TUI
  ├── mebius CLI
  ├── Login / Doctor / Workspace Bootstrap
  └── REST + SSE Client

Android Companion App
  ├── Login / Dashboard / Session Views
  ├── Encrypted Session Store
  └── Retrofit + OkHttp SSE Client

NestJS API
  ├── Auth / Users
  ├── System Capabilities
  ├── Mobile Overview
  ├── Model Configs
  ├── Projects
  ├── Sessions
  ├── Agent
  ├── Tools
  ├── MCP
  ├── Events
  └── Audit

External / Runtime Resources
  ├── PostgreSQL
  ├── Managed Workspace Storage
  ├── Attached Local Workspace Root
  ├── Git / Node / Python Commands
  ├── Remote MCP Servers / Exa Web Search
  └── OpenAI-compatible Providers
```

后端模块职责如下：

| 模块 | 职责 |
| --- | --- |
| `auth` | 注册邮箱验证码发送与校验、注册、登录、JWT 签发、当前用户查询、密码修改、布局和主题偏好更新 |
| `users` | 用户实体、邮箱唯一性、密码哈希、角色、布局偏好和主题偏好合并 |
| `system` | 对外声明后端版本、serverMode、workspace modes、source types 和功能开关 |
| `mobile` | Android 概览聚合，返回当前用户、系统能力、项目、最近会话、待审批项和轻量审批预览 |
| `model-configs` | 模型配置 CRUD、Provider 预设搜索、连接校验、API Key 加密 |
| `projects` | 项目 CRUD、managed/local 工作区路径维护、Git/ZIP 导入、local workspace create-or-get、文件 API、Git 发布操作、`AGENTS.md` 项目指令读取与生成 |
| `sessions` | 会话、消息、上下文摘要、Slash Command、会话权限模式和当前 Agent 活动 |
| `agent` | Plan Mode 生命周期、澄清问答、计划讨论与修订、模型调用、工具循环、工具审批后的恢复执行、活动技能注入、项目指令注入、MCP 工具注入、未知工具名校验 |
| `tools` | 工具调用、审批、Web 检索、MCP 工具执行、补丁、命令运行、补丁回滚和回合撤销/重做 |
| `mcp` | 用户级远程 MCP Server 配置、Context7 预设、工具发现、诊断、启停管理和工具调用转发 |
| `events` | SSE 事件发布与流结束通知 |
| `audit` | 关键操作记录和分页查询 |
| `common/security` | API Key 加密、路径沙箱、命令策略 |

## 3. 前端设计

### 3.1 路由

前端路由由 `frontend/src/router.ts` 管理：

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/login` | `AuthView` | 登录 |
| `/register` | `AuthView` | 注册，可填写管理员邀请码 |
| `/app` | `WorkspaceView` | 主工作区 |
| `/settings/models` | `ModelsView` | 模型配置管理 |
| `/settings/commands` | `CommandsView` | 命令权限管理 |
| `/settings/audit` | `AuditView` | 审计日志查询 |

所有业务页面都要求登录。未登录用户访问受保护页面时跳转到登录页，已登录用户访问登录或注册页时跳转到工作区。Web 客户端展示 local 项目时应标注为 server local workspace，避免用户误解为浏览器本机路径。

### 3.2 状态管理

| Store | 状态与行为 |
| --- | --- |
| `auth` | 保存用户、Token、登录注册、退出、布局偏好、主题偏好和本地主题缓存 |
| `workspace` | 保存项目、会话、消息、文件树、当前文件、计划、补丁、命令运行、可用命令、命令授权状态、回合撤销/重做结果、Git 状态和 SSE 状态 |
| `approvals` | 查询待审批工具调用，执行批准或拒绝 |
| `locale` | 中英文界面文本 |

### 3.3 关键组件

- `WorkspaceFileTree`：展示项目文件树，触发文件选择、重命名和删除。
- `CodeEditor`：使用 CodeMirror 编辑当前文本文件。
- `CodePreview`：使用 Shiki 高亮展示代码，并按当前明暗主题切换 `light-plus` / `dark-plus`。
- `DiffPreview`：展示 Agent 生成补丁的差异。
- `MessageContent`：渲染 Markdown、表格、链接和 KaTeX 数学公式，并通过 DOMPurify 做 HTML 净化；tool role 消息默认展示工具摘要，详情折叠查看。
- `ThemeToggle`：在工作区顶部切换明暗主题，并通过用户偏好接口持久化选择。

`WorkspaceView` 右侧工作台分为文件、审查、运行和事件四个页签。文件页签保留文件树和文件预览的独立滚动区域，审查页签和运行页签采用面板级滚动，保证长计划、长审批列表、命令申请表单和命令输出可以整体上下翻动。主工作区采用项目侧栏、会话栏、聊天区和上下文侧栏的多面板布局；项目侧栏和上下文侧栏保存折叠状态与宽度，会话栏保存折叠状态。会话栏折叠时聊天区切换为单列占满剩余宽度；项目侧栏 resize handle 只负责宽度拖拽，滚轮事件转交给侧栏滚动容器，避免拖拽热区覆盖纵向滚动。

Web 聊天输入区使用 Build / Plan 分段模式：Build 模式将普通文本提交给 Agent，Plan 模式创建计划；`/undo`、`/redo`、`/clear`、`/compact` 等 Slash Command 始终按命令处理，不受当前模式影响。批准后的计划通过 `approvedPlanId` 触发执行。前端在 `done` 事件后重新拉取服务端消息以校准流式临时内容；在 `turn_undone`、`turn_redone` 和 `plan_updated` 事件后刷新消息、补丁、命令运行记录和计划。

### 3.4 主题与可读性

`App.vue` 使用 Naive UI 的 `darkTheme`、`lightTheme` 和 `themeOverrides` 统一控件颜色，`styles.css` 通过 CSS variables 定义全局背景、面板、边框、正文、次级文字、弱文字、代码块和工作区专用 token。`index.html` 在 Vue 挂载前根据 `localStorage` 写入 `data-theme`，避免页面初始渲染时出现主题闪烁。

浅色主题采用 `#111827` 作为正文主色、`#4B5563` 作为次级文字、`#6B7280` 作为弱文字，页面背景为 `#F8FAFC`，卡片为 `#FFFFFF`，边框为 `#D1D5DB`。Workspace 最终样式层只在 `:root[data-theme="light"]` 下覆盖侧边栏、聊天消息、文件树、按钮、输入框、代码块和预览组件，保证浅色主题可读性，同时不破坏暗色主题。

## 4. TUI 客户端设计

TUI 包位于 `tui/`，使用 Bun 作为运行时，`@opentui/core`、`@opentui/solid` 和 `solid-js` 构建终端界面。发布到 npm 时包名为 `mebius-code`，包内 CLI bin 命令固定为 `mebius`。npm 包本身只包含 Node shim 和 postinstall 安装器，安装时从 GitHub Releases 下载 `mebius-<platform>-<arch>` 原生二进制并校验 `SHA256SUMS`；这样终端用户可以通过 `npm install -g mebius-code` 安装，不需要先理解或手动安装 Bun。

除 npm 外，TUI 还提供两类直接安装入口：Linux/macOS 使用 `curl -fsSL https://raw.githubusercontent.com/AlbertTeslaWizard/Mebius-Code/main/scripts/install-tui.sh | bash`，Windows 使用 PowerShell 执行 `scripts/install-tui.ps1`。这些安装器支持 `MEBIUS_CODE_VERSION` 固定版本和 `MEBIUS_INSTALL_DIR` 自定义安装目录，并从同一组 GitHub Release 资产下载、校验和安装二进制。发布版默认 API 为 `http://182.92.150.169/api`，用户仍可用 `--api` 或配置命令切换到自有后端。

TUI 支持以下命令：

| 命令 | 说明 |
| --- | --- |
| `mebius` | 默认以 `process.cwd()` 作为目标路径启动工作台 |
| `mebius /path/to/project` | 显式指定目标路径 |
| `mebius login --api <url>` | 登录并持久保存 API 地址和 JWT |
| `mebius logout` | 清理本地 JWT |
| `mebius doctor` | 检查 Bun、API 连通性、登录状态、当前目录、Git 仓库和 local workspace 能力 |
| `mebius --api <url>` | 仅本次启动临时覆盖 API 地址 |
| `mebius --version` | 输出 TUI 版本 |
| `mebius config set api <url>` | 持久保存 API 地址 |

MVP 阶段 `mebius` 不自动启动 NestJS 后端，而是连接已经运行的 API。启动时先调用 `GET /api/system/capabilities`，再根据 API 地址判断本机模式或远程 API 模式：localhost、127.0.0.1 和 ::1 视为本机 API，可以在后端允许时创建 local workspace；其他地址视为 remote API，只能打开远程后端已有项目，不能提交客户端本机路径。

远程 API 模式下，TUI 不扫描本机技能文件，`/skills` 命令提示技能发现仅在本机模式下可用。

TUI 工作台采用三栏结构：左侧展示项目、Session、文件树和 Git 状态；中间展示聊天记录、流式输出、Agent 活动指示器和输入框；右侧默认展示 Status / Session 状态面板，并在审批时切换为审批预览。终端宽度不足时，右侧和左侧面板可以折叠或切换。

TUI 的命令入口包括聊天输入中的 Slash Command 和 `Ctrl+P` 命令面板。输入区有 Build 与 Plan 两种模式，`Tab` 切换模式；Build 模式运行 Agent，Plan 模式创建计划，Slash Command 始终优先按命令处理。`/new` 创建并切换到新会话，`/sessions` 打开全屏历史会话选择器，`/models` 打开模型选择器，`/skills` 打开技能浏览与选择界面，`/mcp` 打开 MCP 浏览与管理界面，`/themes` 切换 TUI 主题，`/permissions` 查询或切换当前会话权限模式，`/init` 生成项目 `AGENTS.md`，`/undo` 和 `/redo` 调用后端回合撤销/重做，`/clear` 和 `/compact` 调用后端会话命令，`/tools expand` 与 `/tools collapse` 控制 tool role 消息详情展开状态。输入 `/` 时触发 Slash 命令自动补全，展示内置命令和已发现技能列表建议，选择建议后执行对应命令或插入技能前缀。`/sessions` 复用 `GET /projects/:projectId/sessions`、`GET /sessions/:id` 和 `GET /sessions/:id/messages` 等既有 API，不新增后端数据结构。

TUI 消息渲染在 OpenTUI Markdown 渲染前执行 `preprocessMarkdownMath()`：对 `\[`/`\]`、`$$`、`\(`/`\)`、行内 `$...$` 和常见 LaTeX 环境做保守识别，跳过 fenced code block，并通过 `@unified-latex/unified-latex-util-parse` 将 `\frac`、`\sqrt`、希腊字母、比较符号和常见函数渲染为终端可读文本。tool role 消息由 `toolMessageSummary()` 提取工具名、查询、命令、目标路径和状态，详细 JSON 通过 `formatToolMessageDetails()` 格式化并截断长内容，避免大工具结果占满终端。

MCP 浏览器通过 `/mcp`、`/mcp refresh` 或 `/mcp verbose` 打开，展示用户已配置的 MCP Server、启用状态、诊断状态、工具数量和工具详情。`/mcp context7` 创建或更新 Context7 预设；`/mcp add <slug> <url>`、`/mcp tools <slug>`、`/mcp enable <slug>`、`/mcp disable <slug>`、`/mcp remove <slug>` 通过后端 Slash Command 管理远程 MCP Server。TUI 中的 MCP 面板支持 Up/Down 导航、Enter/Tab 打开详情、Space 启停服务器、Ctrl+R 刷新诊断和 Escape 返回或关闭。

空会话应展示品牌欢迎界面，包含 Mebius Code 标识、输入框、Slash 命令建议和键盘快捷键提示，引导用户开始首次交互。

历史会话选择器按后端返回的 `updatedAt` 倒序展示同一项目下的会话，并在 TUI 本地按 Today、Yesterday 和具体日期分组。选择某个会话后，TUI 会停止旧会话 SSE，重新拉取会话详情、消息、最新计划、命令运行记录、待审批项、Git 状态和模型选择状态，更新 `recentSessionId` 后再订阅新会话 SSE。由于 Web 和 TUI 共用同一后端项目会话 API，同一 workspace 的历史会话天然多端互通。

右侧 Status 面板按 Session、Model、Context、Workspace 和 Logs 分组展示摘要信息：Session 展示会话名、会话 ID、当前模式和任务状态；Model 展示当前模型和 Provider；Context 展示当前消息上下文的 token 估算、使用比例占位和成本占位；Workspace 展示工作区路径、local/remote API mode、后端可达状态和 local workspace 开关。Logs 分组只渲染最近少量高层 SSE 事件，例如 `agent_status`、`message_created`、`model_call_started`、`model_call_completed`、`model_call_failed`、`error` 和 `done`，不渲染逐 token 流事件，避免默认界面呈现为调试控制台。

聊天区域顶部展示 Agent 活动指示器（`AgentActivityIndicator`），根据 `turnActive`、`streamStatus` 和 `session.agentActivity` 计算当前阶段（thinking、responding、editing files、running tool、waiting model），以动画进度条形式展示，空闲时隐藏。ChatPanel 内联渲染工具审批面板和 Plan 问答/审查/批准面板，用户可以在聊天区域直接操作审批，无需切换右侧面板。

Plan 就绪面板支持开始实施、修改计划、继续讨论和取消。修改计划调用 `POST /plans/:id/revise`，把用户修订指令、项目指令和活动技能一起交给后端重新生成计划；继续讨论调用 `POST /plans/:id/discuss`，在当前计划上下文中生成一条讨论回复，不改变计划状态。计划批准后 TUI 自动切回 Build 模式，后续空输入执行已批准计划时携带 `approvedPlanId`。

本阶段 TUI 不实现 LSP 相关能力，也不显示 LSP 状态。语言服务器、自动补全、跳转定义等 IDE 能力留作后续扩展，不进入当前后端协议和 TUI 默认界面。

### 4.1 技能系统

TUI 实现完整的技能发现、浏览、选择和注入工作流：

- **技能发现**：`discovery.ts` 按优先级扫描 `.mebius/skills/`、`.opencode/skills/`、`.claude/skills/`（工作区级）、用户全局目录和自定义目录下的 `SKILL.md` 文件。每个技能为包含 `SKILL.md` 的目录，frontmatter 支持 `name`、`description` 和 `summary` 字段。工作区级技能优先于同名全局技能，扫描时跳过 `.git`、`node_modules`、`dist`、`build` 等目录，并通过 `assertSafeSkillFile()` 拒绝符号链接逃逸。
- **技能选择**：`selection.ts` 提供 `filterSkills()` 按名称、描述和来源过滤技能；`selectExplicitSkills()` 将命令行 `/skill-name` 前缀和活动切换技能合并，上限为 3 个；`parseSkillCommandInput()` 从用户输入中提取 `/skill-name` 前缀，分离技能命令和提示文本。
- **技能界面**：`SkillsPaletteModel` 管理技能浏览状态，支持列表视图和详情视图；使用 Ctrl+R 强制刷新；Escape 键从详情返回列表或关闭面板。输入框 `/` 触发自动补全时，动态发现的技能名称与内置 Slash 命令一起展示为建议。
- **活动技能注入**：用户提交消息或计划时，`prepareSkillPrompt()` 解析 `/skill-name` 前缀，加载技能内容，构造 `ActiveSkillContext` 数组（`name`、`source`、`skillFile`、`content`），通过 `runAgent()` 和 `createPlan()` API 传递给后端。

 Skills 模型只在本机模式下自动发现，远程 API 模式下 `/skills` 命令应给出不可用提示，不扫描或提交本机技能文件。

TUI 本地配置保存 apiBaseUrl、JWT、最近项目、最近会话和偏好设置。Windows 使用 `%APPDATA%/Mebius/config.json`，Linux/macOS 使用 `~/.config/mebius/config.json`，配置文件尽量限制为当前用户读写。`preferences.skillDirs` 可指定自定义技能扫描目录。

TUI 技能发现按优先级扫描以下目录：`.mebius/skills/`、`.opencode/skills/`、`.claude/skills/`（工作区级，最高优先级）、`~/.claude/skills/`、`~/.claude/plugins/cache/`、`~/.claude/plugins/marketplaces/`、`~/.config/opencode/skills/`、`~/.opencode/skills/`（全局级）、以及 `preferences.skillDirs`（用户自定义目录）。

## 5. Android 客户端设计

Android 伴随客户端位于 `android/`，使用 Kotlin、Jetpack Compose、Material 3、Retrofit、OkHttp SSE、kotlinx.serialization 和 EncryptedSharedPreferences。它不是手机 IDE，也不承担本地 workspace、Git、MCP 或技能管理职责，而是面向移动端快速查看和决策的轻量客户端。

Android 构建通过 `BuildConfig.DEFAULT_API_BASE_URL` 注入默认 API 地址：debug 构建使用 `http://10.0.2.2:3000/api` 便于模拟器连接宿主机开发后端，release 构建使用公网演示 API `http://182.92.150.169/api`，登录页和设置页仍允许用户修改。release APK 由 GitHub Actions 使用签名 keystore secret 构建并上传到 GitHub Releases，课程演示阶段采用 APK 侧载分发，不强依赖应用市场审核周期。

Android 的信息架构分为登录页、设置页、概览页、项目会话页和会话详情页。登录页连接已有 API 并在本地安全保存 API 地址、JWT 和显示名称；设置页展示当前用户和 API base URL，保存前用当前 session 验证新地址，并支持确认登出；概览页聚合当前用户、系统能力、项目、最近会话和待审批项；项目会话页展示项目下的会话列表并支持新建、重命名、删除；会话详情页展示消息流、计划卡、工具审批卡、补丁摘要、命令结果和 SSE 状态。

Android 复用后端同一套会话、计划和审批接口：`/mobile/overview` 提供概览聚合，`/projects/:projectId/sessions` 和 `/sessions/:id` 管理会话，`/sessions/:id/messages` 与 `/sessions/:id/events` 提供消息和 SSE，`/sessions/:id/run` 与 `/sessions/:id/plan` 发送 Build / Plan 输入，`/plans/:id/approve`、`/plans/:id/cancel` 和 `/approvals/:id/approve|reject` 处理计划与工具决策。工具审批在 Android 上仅保留一次性批准和拒绝，避免把移动端做成完整工作台。

Android 会话详情默认按“消息流 + 计划卡 + 审批卡 + 结果摘要”组织，消息中的 tool role 以可读摘要形式展示，不展开成 Web 端那样的完整编辑和命令控制面板。`MessageMarkdown` 支持标题、列表、引用、代码、表格、链接和显示数学块；数学块通过本地 `android_asset/katex/` 中的 KaTeX JS/CSS/字体在受限 WebView 中渲染，WebView 禁用网络加载和跨文件访问，仅允许加载随包 KaTeX 资源。SSE 事件用于驱动会话状态、流式文本、计划更新和会话删除后的界面重载。

## 6. 数据设计

核心实体及关系如下：

| 实体 | 关键字段 | 关系 |
| --- | --- | --- |
| `User` | email、nickname、passwordHash、role、preferences | 拥有模型配置、项目、会话、MCP Server 配置和审计记录；preferences 包含布局宽度、左右侧栏和会话栏折叠状态、明暗主题和自定义技能目录 |
| `EmailVerificationCode` | email、purpose、codeHash、expiresAt、consumedAt、attempts | 保存注册验证码哈希、过期时间、消费状态和尝试次数 |
| `ModelConfig` | displayName、baseUrl、modelName、providerId、encryptedApiKey、supportsTools、isDefault | 属于一个用户，可作为会话活动模型 |
| `Project` | name、description、sourceType、workspaceMode、workspacePath、deletePolicy、gitUrl | 属于一个用户，包含多个会话；manual/git/archive 为 managed workspace，local 为 attached workspace |
| `Session` | title、status、activeModelConfig | 属于用户和项目，包含消息、计划、工具调用 |
| `Message` | role、content、metadata、deletedAt | 属于会话和可选 Agent 回合，用于还原模型上下文；撤销回合时软删除 |
| `ConversationSummary` | content、tokenEstimate | 属于会话，用于 `/compact` |
| `AgentTurn` | kind、status、metadata、undoneAt | 属于会话，关联一次聊天、计划、计划修订、计划讨论、计划执行或手动命令回合 |
| `Plan` | goal、summary、status、clientRequestId、draftMarkdown、finalMarkdown、questions、answers | 属于会话和可选 Agent 回合，包含多个步骤；`clientRequestId` 用于客户端重试幂等 |
| `PlanStep` | order、title、detail、status | 属于计划 |
| `ToolCall` | name、arguments、status、requiresApproval、resultText | 属于会话和可选 Agent 回合，可关联审批、补丁和命令运行 |
| `ToolApproval` | status、reason、requester、approver | 关联一个工具调用 |
| `FilePatch` | relativePath、originalContent、patchedContent、diffText、status | 记录补丁提议、应用、冲突、拒绝和回滚 |
| `CommandRun` | command、cwd、exitCode、stdout、stderr、status | 记录命令执行过程和结果 |
| `CommandPolicyConfig` | enabledPresets、customCommands | 保存全局命令策略 |
| `ProjectCommandPermission` | command | 保存管理员授权的项目级命令 |
| `SessionCommandGrant` | grantType、createdBy | 保存当前会话的命令自动执行授权 |
| `SessionApprovalRule` | toolKind、pattern、scope、createdBy | 保存当前会话内由审批产生的可复用工具规则 |
| `McpServerConfig` | name、slug、url、transport、enabled、encryptedHeaders、isPreset | 属于一个用户，保存远程 MCP Server 配置和加密 Header |
| `AuditLog` | action、resourceType、resourceId、metadata | 记录关键业务操作 |
| `ActiveSkillContext` | name、source、skillFile、content | 运行时传递的活动技能上下文，随 Agent 运行或 Plan 创建请求注入模型上下文 |

`Project.sourceType` 支持 `manual`、`git`、`archive`、`local`。`workspaceMode` 支持 `managed` 和 `attached`。`deletePolicy` 支持 `delete_managed_files_allowed` 和 `db_record_only`。数据库迁移为旧项目补默认值：旧 manual/git/archive 项目保持原 sourceType，workspaceMode 为 managed，deletePolicy 为 delete_managed_files_allowed。

local 项目的唯一性以 ownerId + 标准化 realpath 为准。Windows 下需要规范化 drive letter 和路径大小写，避免同一目录重复创建。

`ActiveSkillContext` 的 `source` 枚举为 `workspace`、`user`、`opencode`、`claude`、`mebius` 和 `custom`。每次 Agent 运行或 Plan 创建请求最多注入 3 个活动技能。技能发现按目录优先级去重，工作区级技能优先于同名的全局技能。

`AgentTurn.kind` 支持 `chat`、`plan`、`plan_revision`、`plan_discussion`、`plan_approval`、`plan_execution`、`manual_command` 和 `legacy`；`AgentTurn.status` 支持 `active` 和 `undone`。撤销时将消息 `deletedAt` 置为当前时间并回滚该回合补丁，重做时清空 `deletedAt` 并恢复补丁。

`McpServerConfig.transport` 当前支持 `streamable_http`。MCP 工具对模型暴露时统一使用 `mcp__<serverSlug>__<toolName>` 命名，后端根据工具注解和 Context7 预设判断是否只读。

`MobileOverview` 是移动端聚合视图，不单独持久化。后端在请求时从用户、系统能力、项目、最近会话、最新计划状态、待审批工具调用和运行中工具调用组合生成，用于降低 Android 首页的多接口往返成本。

## 7. API 设计

后端全局前缀为 `/api`，接口分组如下：

| 分组 | 主要接口 |
| --- | --- |
| 健康检查与系统能力 | `GET /health`、`GET /system/capabilities` |
| 认证 | `POST /auth/register/verification-code`、`POST /auth/register`、`POST /auth/login`、`GET /auth/me`、`PATCH /auth/me/password`、`PATCH /auth/me/preferences` |
| 移动端 | `GET /mobile/overview` |
| 模型配置 | `GET/POST /model-configs`、`PATCH/DELETE /model-configs/:id`、`POST /model-configs/:id/test` |
| 项目 | `GET/POST /projects`、`POST /projects/local`、`DELETE /projects/:id`、`POST /projects/:id/import/git`、`POST /projects/:id/import/archive` |
| 文件 | `GET /projects/:id/tree`、`GET/POST/PUT/PATCH/DELETE /projects/:id/file` |
| Git | `GET /projects/:id/git/status`、`POST /projects/:id/git/stage`、`POST /projects/:id/git/unstage`、`POST /projects/:id/git/stage-all`、`POST /projects/:id/git/unstage-all`、`POST /projects/:id/git/commit`、`POST /projects/:id/git/push` |
| 会话 | `POST /projects/:projectId/sessions`、`GET /projects/:projectId/sessions`、`GET/PATCH/DELETE /sessions/:id`、`GET/POST /sessions/:id/messages`、`POST /sessions/:id/commands` |
| 事件 | `GET /sessions/:id/events?access_token=<jwt>` |
| Agent | `POST /sessions/:id/plan`、`GET /sessions/:id/plans/latest`、`PATCH /plans/:id/answers`、`POST /plans/:id/finalize`、`POST /plans/:id/approve`、`POST /plans/:id/revise`、`POST /plans/:id/discuss`、`POST /plans/:id/cancel`、`POST /sessions/:id/run` |
| 审批与工具 | `GET /approvals/pending`、`POST /approvals/:id/approve`、`POST /approvals/:id/reject`、`GET /sessions/:id/patches`、`POST /patches/:id/revert`、`POST /sessions/:id/undo`、`POST /sessions/:id/redo`、`GET/POST /sessions/:id/command-runs`、`GET/DELETE /sessions/:id/command-authorization` |
| 命令策略 | `GET /command-policy`、`PATCH /command-policy`、`GET /sessions/:id/allowed-commands` |
| 审计 | `GET /audit-logs` |

`GET /api/system/capabilities` 返回后端版本、`serverMode`、local workspace 是否启用、支持的 workspace modes、source types 和功能开关。`serverMode` 枚举为 `development`、`local_runtime`、`production`，production 模式下 local workspace 必须强制关闭，即使环境变量误开也拒绝。

`POST /api/projects/local` 是 create-or-get 接口。后端校验调用者权限和 serverMode，对 path 执行 realpath；如果同一 ownerId 和 normalized realpath 已存在 local 项目，则返回已有项目，否则创建 sourceType=local、workspaceMode=attached、deletePolicy=db_record_only 的项目记录。

`GET /api/mobile/overview` 面向 Android 伴随客户端，返回当前用户、系统能力、最多 50 个项目、最多 20 个最近会话、最多 20 个待审批项。最近会话包含项目名、权限模式、当前模型、Agent 活动、最新计划状态和待审批数量；待审批项只返回移动端可读的轻量预览，完整 Diff 和命令上下文仍通过会话详情接口按需加载。

`POST /sessions/:id/run` 和 `POST /sessions/:id/plan` 均接受可选 `activeSkills` 数组参数，每项包含 `name`、`source`、`skillFile` 和 `content`，最多 3 项。后端将活动技能作为系统消息注入模型上下文，并附带工具能力声明。`POST /sessions/:id/plan` 的 `clientRequestId` 用于幂等创建，避免客户端重试导致同一会话生成重复计划。`POST /sessions/:id/run` 可携带 `approvedPlanId`，用于执行已批准计划。

`POST /plans/:id/revise` 接收修订指令和可选活动技能，重新生成当前计划草案、步骤和澄清问题。`POST /plans/:id/discuss` 接收讨论消息，在当前计划上下文中生成回复，不直接改变计划状态。

`POST /sessions/:id/commands` 统一承载 Slash Command。除 `/clear`、`/compact`、`/models`、`/connect` 外，还支持 `/init`、`/permissions`、`/stream-test` 和 `/mcp` 系列命令。`/init` 代理到项目指令生成能力；`/mcp` 代理到 MCP Server 管理与诊断能力。

## 8. 关键流程设计

### 8.1 注册与登录

1. 前端先调用 `POST /auth/register/verification-code` 请求注册邮箱验证码。
2. `EmailVerificationService` 校验邮箱未注册、发送频率和全局上限，生成 6 位验证码，bcrypt 哈希后保存到 `EmailVerificationCode`，并通过 `MailService` 使用 SMTP 发送邮件。
3. 前端提交邮箱、昵称、密码、验证码和可选管理员邀请码。
4. `AuthService` 校验并消费验证码，再使用 bcrypt 哈希密码。
5. `UsersService` 校验邮箱唯一性并创建用户。
6. 若邀请码匹配 `ADMIN_INVITE_CODE`，用户角色为管理员。
7. `JwtService` 签发 JWT，前端保存 Token 并进入工作区。
8. 用户通过 `PATCH /auth/me/preferences` 更新布局和主题偏好，后端归一化宽度范围、左右侧栏折叠、会话栏折叠和主题枚举，前端同时更新本地主题缓存。

### 8.2 模型连接

1. 用户在设置页手动创建模型配置，或在会话中输入 `/connect`。
2. `ModelConfigsService` 根据 Provider 预设或自定义输入解析 base URL。
3. 后端调用 Provider 的 `/models` 接口校验 API Key 和模型可用性。
4. API Key 通过 `EncryptionService` 使用 AES-256-GCM 加密保存。
5. 返回前端的模型配置经过 sanitize，不包含密钥。

### 8.3 项目导入与文件访问

1. 用户创建 managed 项目后，`PathSandboxService` 为项目创建独立工作区目录。
2. Git 导入使用 `git clone --depth 1`，可指定分支。
3. ZIP 导入解析中心目录，拒绝 Zip64、加密归档、目录穿越、绝对路径、重复路径和过大归档。
4. 文件读取、保存、删除和重命名都通过 `resolveProjectPath` 解析路径，保证目标仍在项目根目录内；local 项目也使用同一套 sandbox 约束。
5. 文件操作写入审计日志。

### 8.4 TUI 本机工作区绑定

1. 用户在本机仓库中执行 `mebius` 或 `mebius /path/to/project`。
2. TUI 读取配置，连接已运行的 API，并调用 `GET /api/system/capabilities`。
3. 若 API 是 localhost、后端 serverMode 不是 production、local workspace 已启用且用户为管理员，TUI 调用 `POST /api/projects/local`。
4. 后端通过 LocalWorkspaceGuard 检查 local workspace 开关和管理员权限，通过 PathSandboxService 校验绝对路径、目录存在性、危险目录和 realpath。
5. 后端以 ownerId + normalized realpath 查找已有项目，存在则返回，不存在则创建 attached local 项目。
6. TUI 获取项目会话列表，没有会话时创建新 session，然后订阅 SSE 并进入工作台。
7. 若 API 是远程地址，TUI 不提交本机 path，只从远程后端已有项目中选择工作区。

### 8.5 Plan Mode 生命周期

1. 用户在 Web 或 TUI 提交目标，`POST /sessions/:id/plan` 创建 `planning_generating` 计划；TUI 传入 `clientRequestId`，后端按 session + clientRequestId 返回已有计划，避免重试重复生成。
2. `AgentService` 调用模型生成严格 JSON，包括 summary、markdown、steps 和 questions；questions 为空时进入 `plan_ready_pending_approval`，否则进入 `plan_customizing`。
3. 客户端通过 `PATCH /plans/:id/answers` 保存澄清答案，答案结构支持单选、多选、自定义回答和备注。
4. 用户确认答案后调用 `POST /plans/:id/finalize`，后端结合草案、步骤和答案生成最终计划，保存 `finalMarkdown` 并进入 `plan_review`。
5. 用户通过 `POST /plans/:id/approve` 批准待批准或审查中的计划；后端把最终计划快照写入会话消息，并将计划置为 `approved`。
6. 用户可以通过 `POST /plans/:id/revise` 提交修订指令，后端创建 `plan_revision` 回合，结合当前计划、项目指令和活动技能重新生成草案、步骤和澄清问题。
7. 用户可以通过 `POST /plans/:id/discuss` 在当前计划上下文中继续讨论，后端创建 `plan_discussion` 回合并生成讨论回复，但不直接改变计划状态。
8. 已批准计划通过 `POST /sessions/:id/run` 携带 `approvedPlanId` 执行，后端校验计划属于当前会话且状态为 `approved`。
9. 用户可以通过 `POST /plans/:id/cancel` 取消未批准计划；旧数据库状态 `pending_approval`、`rejected`、`running` 和 `completed` 在读取时归一化为当前状态。
10. TUI 通过跟踪已处理的计划决定 ID（`dismissedPlanDecisionId`）防止重新进入会话时恢复过期审批界面；已批准、已取消或已失败的计划不再弹出审批面板，并在批准后切回 Build 模式。

### 8.6 Agent 执行与工具循环

1. 用户发送消息或执行已批准计划后，`AgentService` 读取会话摘要和最近消息，构造模型上下文。
2. `AgentService` 读取项目根目录 `AGENTS.md`，最多取 32KB，作为项目指令系统消息注入模型上下文。
3. 若请求携带 `activeSkills`，`AgentService` 将每个活动技能构造为系统消息注入模型上下文，格式为 `# Active Skill: <name>\nSource: <source>\n\n<content>`，并附带声明模型只可使用已注册工具。
4. 系统将当前项目允许的命令前缀、后端运行平台、shell 类型、`web_search` 可用性和已启用 MCP 工具列表注入 system prompt 与工具描述。
5. `OpenAiCompatibleService` 流式调用模型，并通过 SSE 推送 token。
6. 模型返回工具调用时，Agent 解析 JSON 参数并交给 `ToolsService`。
7. Agent 在分发工具调用前校验工具名是否在已知集合中，包括基础编码工具、`web_search` 和当前用户启用的 MCP 工具。若工具名未知，Agent 记录友好错误消息作为工具结果，发布 `agent_status` 事件（`activity: 'unknown_tool'`），将工具调用标记为 Failed 并继续回合，而非中断会话。
8. 只读工具、`web_search` 和只读 MCP 工具直接执行，结果作为 tool message 写入会话并继续模型回合。
9. 写入补丁、未授权命令执行或非只读 MCP 工具会生成待审批记录，Agent 暂停并等待用户批准。
10. 用户批准后，系统执行工具、记录结果，再由 Agent 根据保存的 pending tool resume context 恢复模型回合，保留审批前的 assistant tool call 和已完成 tool messages。
11. 达到最大工具轮数仍未完成时，系统保存提示消息并标记最新运行中的计划失败。
12. Agent 回合结束时发布 `done` 事件。Web 和 TUI 收到后重新拉取服务端消息；TUI 对 undo/redo 事件还同步刷新审批、计划、命令运行、Git 状态和模型选择，保证终端 transcript 与后端持久化状态一致。

### 8.7 补丁应用与回滚

1. `create_patch` 接收单文件或多文件完整目标内容。
2. 系统保存原始内容、目标内容和 Diff，状态为 `proposed`。
3. 用户批准时，系统重新读取当前文件内容并与原始快照比较。
4. 内容一致则写入文件并将补丁标记为 `applied`。
5. 内容不一致则标记为 `conflicted`，不写入文件。
6. 用户回滚补丁时，系统要求当前文件仍等于补丁后的内容；否则拒绝回滚。

### 8.8 命令执行与策略

1. `CommandPolicyService` 将命令标准化，硬性拒绝命令替换、反引号和换行。
2. 命令链、管道和重定向被归类为 shell 执行模式，不再在审批前直接失败。
3. 常规 argv 命令先检查环境白名单、管理员启用的预设、自定义命令和项目级授权命令。
4. `GET /sessions/:id/allowed-commands` 返回当前项目实际可用的命令前缀，工作区运行面板据此生成命令下拉选项。
5. 运行面板的工作目录选项由项目文件树中的目录节点生成，空值代表项目根目录，后端仍通过路径沙箱做最终校验。
6. `GET /sessions/:id/command-authorization` 返回当前会话命令自动执行授权状态，`DELETE /sessions/:id/command-authorization` 用于撤销授权。
7. Agent system prompt 和 `run_command` 工具描述通过 `resolveCommandRuntime` 注入后端平台和 shell 信息，Windows 指向 `cmd.exe`，Linux/macOS 指向 `/bin/sh`。
8. 无会话授权时，策略外命令和 shell 命令进入审批；用户可仅运行本次，或信任当前会话并生成 `SessionCommandGrant`。
9. 非 shell 命令可由管理员授权为项目级可复用命令；shell 命令不得保存为项目级前缀。
10. 常规命令通过 `spawn` 的 argv 模式执行，shell 命令通过显式 shell 执行，输出和退出码写入 `CommandRun`。

### 8.9 Git 发布

1. `ProjectsService` 通过 `git status --short --branch` 获取分支、跟踪分支和文件状态。
2. 系统检查当前项目根目录本身是否为 Git 仓库，避免误用父目录仓库。
3. 用户可以 stage、unstage、commit、push。
4. commit 前要求存在已暂存改动，push 前要求存在远端和可推送提交。
5. Git 操作均写入审计日志。

### 8.10 项目指令初始化

1. 用户在 TUI 输入 `/init`、`/init --preview` 或 `/init --replace`。
2. `SessionsService` 校验参数并调用 `ProjectsService.initAgentInstructions()`。
3. `ProjectsService` 检查项目根目录，识别 package、tsconfig、Docker、README 等清单文件、顶层目录和常见命令，生成 `AGENTS.md` 初稿。
4. 预览模式只返回生成内容；已有文件且未指定替换时返回现有内容和建议内容；替换模式或首次创建时写入项目根目录。
5. 创建或替换 `AGENTS.md` 写入审计日志，后续 Agent 运行时读取该文件并注入模型上下文。

### 8.11 MCP 工具接入

1. 用户通过 `/mcp context7`、`/mcp add <slug> <url>` 等命令创建远程 MCP Server 配置。
2. `McpService` 标准化 slug 和 URL，加密保存 Header，按 owner + slug 保证唯一。
3. TUI 通过 `/mcp refresh`、`/mcp verbose` 或 MCP 浏览器请求工具列表和诊断状态。
4. 后端使用 MCP Streamable HTTP 调用 `initialize`、`tools/list` 和 `tools/call`，缓存工具列表和诊断结果，并隐藏 URL 或错误信息中的敏感参数。
5. Agent 运行前读取当前用户启用的 MCP 工具，把工具以 `mcp__<serverSlug>__<toolName>` 名称加入模型工具列表。
6. 只读 MCP 工具直接执行，非只读工具进入通用工具审批流程。

### 8.12 回合撤销与重做

1. 每次聊天、计划创建、计划修订、计划讨论、计划批准、计划执行和手动命令都会创建 `AgentTurn`。
2. `/undo` 调用 `POST /sessions/:id/undo`，查找最近 active 回合；如存在待审批工具调用，则拒绝撤销。
3. 系统检查该回合已应用补丁的快照，若文件在应用后被外部修改则返回冲突，不写入文件。
4. 无冲突时，系统按反向顺序回滚补丁、软删除该回合消息、标记回合为 `undone`，并发布 `turn_undone`。
5. `/redo` 调用 `POST /sessions/:id/redo`，查找最近 undone 回合；若补丁快照无冲突，则恢复消息、重放补丁并发布 `turn_redone`。
6. 计划相关回合撤销或重做时同步发布 `plan_updated`，客户端据此刷新计划状态。

### 8.13 Android 移动会话流程

1. 用户在 Android 登录页输入 API 地址、邮箱和密码，客户端调用 `POST /auth/login`，成功后用 EncryptedSharedPreferences 保存 API 地址和 JWT。
2. Android 启动或刷新时调用 `GET /mobile/overview`，一次性获得用户、系统能力、项目、最近会话和待审批概览。
3. 用户打开会话后，Android 并行读取会话详情、消息、最新计划、待审批项、补丁列表和命令运行记录，再订阅 `GET /sessions/:id/events`。
4. 用户提交 Build 输入时调用 `POST /sessions/:id/run`；提交 Plan 输入时调用 `POST /sessions/:id/plan`，并在收到 SSE 事件后刷新会话详情。
5. 对计划卡片，Android 支持回答首个澄清问题、定稿、批准并执行、取消；对工具审批，Android 只提供一次性批准和拒绝。
6. 当 SSE 收到 `session_deleted`、`message_created`、`plan_updated` 或 `tool_call_result` 等事件时，客户端停止旧流或刷新当前会话，保持移动端视图与 Web/TUI 一致。
7. 用户进入设置页修改 API 地址时，客户端先用当前 JWT 请求新地址的概览接口，验证成功后持久化新 API base URL 并刷新移动概览；登出时清理 EncryptedSharedPreferences 中的会话信息。

## 9. 安全设计

- 认证安全：所有业务接口使用 JWT Guard；SSE 使用 `access_token` 查询参数配合专用 Guard。
- 密码安全：密码使用 bcrypt 哈希，不保存明文。
- 注册验证安全：注册验证码使用 bcrypt 哈希保存，设置 10 分钟过期、重发冷却、每邮箱/全局发送频率限制和最大校验次数限制。
- 密钥安全：模型 API Key 使用主密钥派生的 AES-256-GCM 加密；响应中永不返回明文。
- MCP 安全：MCP Header 使用同一加密服务保存；MCP URL 展示和诊断错误会脱敏 api key、token、secret、password、authorization 等敏感内容；MCP 返回内容作为不可信外部上下文处理。
- Web 检索安全：`web_search` 默认禁止包含密钥、token、私钥等敏感模式的查询；Exa/Tavily 返回内容只作为资料，不得覆盖系统、开发者或项目指令。
- 项目指令安全：`AGENTS.md` 只从项目根目录读取，读取上限为 32KB，且其优先级低于系统和开发者指令。
- 路径安全：managed 项目和 local 项目统一通过 `PathSandboxService` 校验。已存在路径使用 realpath 检查仍在 workspaceRoot 内；新建文件检查父目录 realpath；禁止符号链接逃逸 workspaceRoot。
- local workspace 安全：local workspace 默认关闭，只在非 production 且 `MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true` 时可用；production 模式强制拒绝；创建 local 项目需要管理员权限；删除 local 项目只删除数据库记录。
- 目录屏蔽：`.git`、`.env`、`node_modules`、`dist`、`coverage` 默认不可访问；真实本地仓库文件树还默认忽略 `build`、`.next`、`.nuxt`、`.cache`、`.venv`、`venv`、`__pycache__`、`.pytest_cache`、`datasets`、`models`、`outputs`、`checkpoints`。
- 命令安全：常规命令必须匹配策略前缀；策略外命令和 shell 命令需要审批或会话授权；命令替换、反引号和换行被硬性拒绝；所有命令都在工作区内执行。
- 人工审批：补丁写入和未授权命令执行需要用户审批，会话级命令自动执行授权可撤销并写入审计。
- 工具安全：模型调用未知工具时，后端返回友好提示消息并标记为 Failed，不中断会话；系统消息明确声明基础工具、Web 检索工具和当前启用的 MCP 工具集合，防止模型幻觉调用不存在的工具。
- 审计追踪：高风险和关键状态变更写入审计日志。

## 10. 部署设计

本地部署使用 Docker Compose。根目录 `docker-compose.yml` 启动：

- `postgres`：PostgreSQL 数据库，端口 `5432`。
- `api`：NestJS 后端，端口 `3000`。

后端通过环境变量配置数据库连接、JWT 密钥、API Key/MCP Header 加密主密钥、工作区根目录、命令白名单、管理员邀请码、SMTP 邮件服务和 Web 检索 Provider。前端开发环境由 Vite 启动在 `http://127.0.0.1:5173`，并将 `/api` 代理到后端。

注册验证码邮件需要设置 `MAIL_ENABLED=true`、`MAIL_FROM`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS` 等变量。Web 检索默认使用 Exa hosted MCP；可通过 `WEB_SEARCH_ENABLED=false` 关闭，通过 `EXA_API_KEY` 或 Tavily 相关变量切换到自有额度。

课程演示服务器部署在 `182.92.150.169`，公网入口为 `http://182.92.150.169/`。部署拓扑如下：

- Nginx 监听 `80` 端口，托管 `frontend/dist` 静态文件，并将 `/api/` 反向代理到本机 `127.0.0.1:3000/api/`。
- PostgreSQL 使用 `postgres:16-alpine` Docker 容器运行，仅绑定 `127.0.0.1:5432`，不直接暴露数据库端口到公网。
- NestJS API 在服务器宿主机上以 `mebius-code-api.service` systemd 服务运行，读取 `/opt/mebius-code/.env`，连接本机 PostgreSQL 容器，并使用 `/opt/mebius-code/workspaces` 作为工作区根目录。
- 服务器启用 2 GiB swap，降低 Node/NPM 构建或依赖安装时对 1.6 GiB 内存机器的影响。
- UFW 仅放行 OpenSSH 和 `80/tcp`；云服务器安全组同步放行 `80/80`，数据库和后端端口不作为公网入口。

上线验收包括：公网首页返回 `200 OK`，`GET http://182.92.150.169/api/health` 返回健康状态，管理员账号可通过 `POST /api/auth/login` 获取 JWT，并可继续访问 `GET /api/auth/me` 确认为 `admin` 角色。由于演示环境未配置 SMTP，初始管理员账号通过一次性数据库写入创建，凭据只保存在服务器 root 用户私有文件中，不写入课程文档或源码。

多端发布通过 `.github/workflows/release.yml` 统一编排。推送 `v*` tag 后，TUI job 在 Ubuntu、macOS Intel、macOS arm64 和 Windows runner 上运行 typecheck、单元测试和 OpenTUI 原生编译，产出 `mebius-linux-x64.tar.gz`、`mebius-darwin-x64.tar.gz`、`mebius-darwin-arm64.tar.gz` 和 `mebius-windows-x64.zip`；Android job 解码签名 keystore secret 并构建 `Mebius-Code-android-<tag>.apk`；发布 job 汇总二进制、APK、`install.sh`、`install.ps1` 和 `SHA256SUMS` 到 GitHub Release；最后 npm job 发布 `mebius-code` 包。npm 安装、curl 安装和 PowerShell 安装都复用同一组 Release 资产，减少平台差异。

TUI 本机测试时，MVP 要求手动启动 PostgreSQL 和 NestJS API，不由 `mebius` 自动拉起后端。local workspace 需要设置 `MEBIUS_CODE_SERVER_MODE=local_runtime` 和 `MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true`，且不能使用 production API 容器绑定 Windows 或用户本机路径。远程 API 模式下，TUI 只操作远程后端已有 workspace。公网发布版默认进入 remote API mode，连接 `http://182.92.150.169/api`，因此不会把用户本机路径注册到云端后端。

Android 客户端使用 Android Studio 或 `android/gradlew :app:assembleDebug` 构建。模拟器 debug 包默认使用 `http://10.0.2.2:3000/api` 访问宿主机后端；GitHub Release 中的签名 release APK 默认使用 `http://182.92.150.169/api`，真机演示安装 APK 后可直接连接公网 API，也可以在登录页或设置页改为自有后端地址。Android 客户端只连接已运行 API，不启动 PostgreSQL 或 NestJS 服务。
Android APK 随包携带 Mebius 应用图标、品牌徽标和 `android_asset/katex/` 本地 KaTeX 资源，移动端数学公式渲染不依赖 CDN 或外部网络。

## 11. UML 图

UML 源文件位于 `docs/diagrams/`：

- `use-case.puml`：展示普通开发者和管理员的系统用例。
- `package.puml`：展示后端模块依赖。
- `domain-class.puml`：展示核心领域实体及关系。
- `deployment.puml`：展示浏览器、前端、后端、数据库、工作区、Git 和模型 Provider 的部署关系。

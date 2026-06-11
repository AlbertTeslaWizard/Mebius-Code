# Mebius Code 系统设计文档

## 1. 技术选型

| 层次 | 技术 | 设计理由 |
| --- | --- | --- |
| 后端框架 | NestJS + TypeScript | 使用类、装饰器、依赖注入、模块和服务组织业务逻辑，适合面向对象课程设计表达 |
| 前端框架 | Vue 3 + TypeScript + Vite | 构建单页 Web 客户端，类型约束明确，开发和演示成本低 |
| TUI 客户端 | Bun + TypeScript + OpenTUI + Solid | 构建可在终端中运行的第二客户端，复用同一套 NestJS API、SSE、审批和工作区能力 |
| 状态管理 | Pinia | 将认证、工作区、审批、本地化、主题偏好等客户端状态模块化 |
| UI 与编辑 | Naive UI、Tailwind CSS、CodeMirror、Shiki、Markdown-it、DOMPurify | 支持工作台界面、明暗主题、代码编辑、代码高亮、Markdown 消息和安全渲染 |
| 数据库 | PostgreSQL | 保存用户、模型配置、项目、会话、消息、计划、审批和审计记录 |
| ORM | TypeORM | 以实体类映射数据库表，便于表达领域对象关系 |
| 认证 | JWT + Passport | 支持 Web 客户端无状态访问受保护接口 |
| 实时事件 | Server-Sent Events | 将模型 token、工具状态、审批、命令输出等事件推送到 Web 和 TUI 客户端 |
| 模型接入 | OpenAI-compatible Chat Completions API | 兼容多个模型 Provider 和工具调用协议 |
| 部署 | Docker Compose | 本地和服务器演示环境都能快速启动 PostgreSQL 与 API 服务 |

## 2. 总体架构

系统采用“前后端分离 + 模块化单体后端 + 多客户端”的架构。后端当前是一个 NestJS 应用，但模块边界按照未来微服务拆分方向设计；Web 前端是 Vue 单页应用，TUI 是 Bun/OpenTUI 终端客户端，二者都通过 REST API 和 SSE 与后端通信。

```text
Browser Web App
  ├── Auth / Workspace / Settings Views
  ├── Pinia Stores
  └── REST + SSE Client

Terminal TUI
  ├── mebius CLI
  ├── Login / Doctor / Workspace Bootstrap
  └── REST + SSE Client

NestJS API
  ├── Auth / Users
  ├── System Capabilities
  ├── Model Configs
  ├── Projects
  ├── Sessions
  ├── Agent
  ├── Tools
  ├── Events
  └── Audit

External / Runtime Resources
  ├── PostgreSQL
  ├── Managed Workspace Storage
  ├── Attached Local Workspace Root
  ├── Git / Node / Python Commands
  └── OpenAI-compatible Providers
```

后端模块职责如下：

| 模块 | 职责 |
| --- | --- |
| `auth` | 注册、登录、JWT 签发、当前用户查询、布局和主题偏好更新 |
| `users` | 用户实体、邮箱唯一性、密码哈希、角色、布局偏好和主题偏好合并 |
| `system` | 对外声明后端版本、serverMode、workspace modes、source types 和功能开关 |
| `model-configs` | 模型配置 CRUD、Provider 预设搜索、连接校验、API Key 加密 |
| `projects` | 项目 CRUD、managed/local 工作区路径维护、Git/ZIP 导入、local workspace create-or-get、文件 API、Git 发布操作 |
| `sessions` | 会话、消息、上下文摘要、Slash Command 和当前 Agent 活动 |
| `agent` | Plan Mode 生命周期、澄清问答、模型调用、工具循环、工具审批后的恢复执行 |
| `tools` | 工具调用、审批、补丁、命令运行和补丁回滚 |
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

所有业务页面都要求登录。未登录用户访问受保护页面时跳转到登录页，已登录用户访问登录或注册页时跳转到工作区。

### 3.2 状态管理

| Store | 状态与行为 |
| --- | --- |
| `auth` | 保存用户、Token、登录注册、退出、布局偏好、主题偏好和本地主题缓存 |
| `workspace` | 保存项目、会话、消息、文件树、当前文件、计划、补丁、命令运行、可用命令、命令授权状态、Git 状态和 SSE 状态 |
| `approvals` | 查询待审批工具调用，执行批准或拒绝 |
| `locale` | 中英文界面文本 |

### 3.3 关键组件

- `WorkspaceFileTree`：展示项目文件树，触发文件选择、重命名和删除。
- `CodeEditor`：使用 CodeMirror 编辑当前文本文件。
- `CodePreview`：使用 Shiki 高亮展示代码。
- `DiffPreview`：展示 Agent 生成补丁的差异。
- `MessageContent`：渲染 Markdown 消息，并通过 DOMPurify 做 HTML 净化。
- `ThemeToggle`：在工作区顶部切换明暗主题，并通过用户偏好接口持久化选择。

`WorkspaceView` 右侧工作台分为文件、审查、运行和事件四个页签。文件页签保留文件树和文件预览的独立滚动区域，审查页签和运行页签采用面板级滚动，保证长计划、长审批列表、命令申请表单和命令输出可以整体上下翻动。

### 3.4 主题与可读性

`App.vue` 使用 Naive UI 的 `darkTheme`、`lightTheme` 和 `themeOverrides` 统一控件颜色，`styles.css` 通过 CSS variables 定义全局背景、面板、边框、正文、次级文字、弱文字、代码块和工作区专用 token。`index.html` 在 Vue 挂载前根据 `localStorage` 写入 `data-theme`，避免页面初始渲染时出现主题闪烁。

浅色主题采用 `#111827` 作为正文主色、`#4B5563` 作为次级文字、`#6B7280` 作为弱文字，页面背景为 `#F8FAFC`，卡片为 `#FFFFFF`，边框为 `#D1D5DB`。Workspace 最终样式层只在 `:root[data-theme="light"]` 下覆盖侧边栏、聊天消息、文件树、按钮、输入框、代码块和预览组件，保证浅色主题可读性，同时不破坏暗色主题。

## 4. TUI 客户端设计

TUI 包位于 `tui/`，使用 Bun 作为运行时，`@opentui/core`、`@opentui/solid` 和 `solid-js` 构建终端界面。包的 CLI bin 命令固定为 `mebius`。

TUI 支持以下命令：

| 命令 | 说明 |
| --- | --- |
| `mebius` | 默认以 `process.cwd()` 作为目标路径启动工作台 |
| `mebius /path/to/project` | 显式指定目标路径 |
| `mebius login --api <url>` | 登录并持久保存 API 地址和 JWT |
| `mebius logout` | 清理本地 JWT |
| `mebius doctor` | 检查 Bun、API 连通性、登录状态、当前目录、Git 仓库和 local workspace 能力 |
| `mebius --api <url>` | 仅本次启动临时覆盖 API 地址 |
| `mebius config set api <url>` | 持久保存 API 地址 |

MVP 阶段 `mebius` 不自动启动 NestJS 后端，而是连接已经运行的 API。启动时先调用 `GET /api/system/capabilities`，再根据 API 地址判断本机模式或远程 API 模式：localhost、127.0.0.1 和 ::1 视为本机 API，可以在后端允许时创建 local workspace；其他地址视为 remote API，只能打开远程后端已有项目，不能提交客户端本机路径。

TUI 工作台采用三栏结构：左侧展示项目、Session、文件树和 Git 状态；中间展示聊天记录、流式输出和输入框；右侧默认展示 Status / Session 状态面板，并在审批时切换为审批预览。终端宽度不足时，右侧和左侧面板可以折叠或切换。

TUI 的命令入口包括聊天输入中的 Slash Command 和 `Ctrl+P` 命令面板。`/new` 创建并切换到新会话，`/sessions` 打开全屏历史会话选择器，`/models` 打开模型选择器，`/themes` 切换 TUI 主题，`/clear` 和 `/compact` 调用后端会话命令。`/sessions` 复用 `GET /projects/:projectId/sessions`、`GET /sessions/:id` 和 `GET /sessions/:id/messages` 等既有 API，不新增后端数据结构。

历史会话选择器按后端返回的 `updatedAt` 倒序展示同一项目下的会话，并在 TUI 本地按 Today、Yesterday 和具体日期分组。选择某个会话后，TUI 会停止旧会话 SSE，重新拉取会话详情、消息、最新计划、命令运行记录、待审批项、Git 状态和模型选择状态，更新 `recentSessionId` 后再订阅新会话 SSE。由于 Web 和 TUI 共用同一后端项目会话 API，同一 workspace 的历史会话天然多端互通。

右侧 Status 面板按 Session、Model、Context、Workspace 和 Logs 分组展示摘要信息：Session 展示会话名、会话 ID、当前模式和任务状态；Model 展示当前模型和 Provider；Context 展示当前消息上下文的 token 估算、使用比例占位和成本占位；Workspace 展示工作区路径、local/remote API mode、后端可达状态和 local workspace 开关。Logs 分组只渲染最近少量高层 SSE 事件，例如 `agent_status`、`message_created`、`model_call_started`、`model_call_completed`、`model_call_failed`、`error` 和 `done`，不渲染逐 token 流事件，避免默认界面呈现为调试控制台。

本阶段 TUI 不实现 LSP 相关能力，也不显示 LSP 状态。语言服务器、自动补全、跳转定义等 IDE 能力留作后续扩展，不进入当前后端协议和 TUI 默认界面。

TUI 本地配置保存 apiBaseUrl、JWT、最近项目、最近会话和偏好设置。Windows 使用 `%APPDATA%/Mebius/config.json`，Linux/macOS 使用 `~/.config/mebius/config.json`，配置文件尽量限制为当前用户读写。

## 5. 数据设计

核心实体及关系如下：

| 实体 | 关键字段 | 关系 |
| --- | --- | --- |
| `User` | email、name、passwordHash、role、preferences | 拥有模型配置、项目、会话和审计记录；preferences 包含布局宽度/折叠状态和明暗主题 |
| `ModelConfig` | displayName、baseUrl、modelName、providerId、encryptedApiKey、supportsTools、isDefault | 属于一个用户，可作为会话活动模型 |
| `Project` | name、description、sourceType、workspaceMode、workspacePath、deletePolicy、gitUrl | 属于一个用户，包含多个会话；manual/git/archive 为 managed workspace，local 为 attached workspace |
| `Session` | title、status、activeModelConfig | 属于用户和项目，包含消息、计划、工具调用 |
| `Message` | role、content、metadata | 属于会话，用于还原模型上下文 |
| `ConversationSummary` | content、tokenEstimate | 属于会话，用于 `/compact` |
| `Plan` | goal、summary、status、clientRequestId、draftMarkdown、finalMarkdown、questions、answers | 属于会话，包含多个步骤；`clientRequestId` 用于客户端重试幂等 |
| `PlanStep` | order、title、detail、status | 属于计划 |
| `ToolCall` | name、arguments、status、requiresApproval、resultText | 属于会话，可关联审批、补丁和命令运行 |
| `ToolApproval` | status、reason、requester、approver | 关联一个工具调用 |
| `FilePatch` | relativePath、originalContent、patchedContent、diffText、status | 记录补丁提议、应用、冲突、拒绝和回滚 |
| `CommandRun` | command、cwd、exitCode、stdout、stderr、status | 记录命令执行过程和结果 |
| `CommandPolicyConfig` | enabledPresets、customCommands | 保存全局命令策略 |
| `ProjectCommandPermission` | command | 保存管理员授权的项目级命令 |
| `SessionCommandGrant` | grantType、createdBy | 保存当前会话的命令自动执行授权 |
| `AuditLog` | action、resourceType、resourceId、metadata | 记录关键业务操作 |

`Project.sourceType` 支持 `manual`、`git`、`archive`、`local`。`workspaceMode` 支持 `managed` 和 `attached`。`deletePolicy` 支持 `delete_managed_files_allowed` 和 `db_record_only`。数据库迁移为旧项目补默认值：旧 manual/git/archive 项目保持原 sourceType，workspaceMode 为 managed，deletePolicy 为 delete_managed_files_allowed。

local 项目的唯一性以 ownerId + 标准化 realpath 为准。Windows 下需要规范化 drive letter 和路径大小写，避免同一目录重复创建。

## 6. API 设计

后端全局前缀为 `/api`，接口分组如下：

| 分组 | 主要接口 |
| --- | --- |
| 健康检查与系统能力 | `GET /health`、`GET /system/capabilities` |
| 认证 | `POST /auth/register`、`POST /auth/login`、`GET /auth/me`、`PATCH /auth/me/preferences` |
| 模型配置 | `GET/POST /model-configs`、`PATCH/DELETE /model-configs/:id`、`POST /model-configs/:id/test` |
| 项目 | `GET/POST /projects`、`POST /projects/local`、`DELETE /projects/:id`、`POST /projects/:id/import/git`、`POST /projects/:id/import/archive` |
| 文件 | `GET /projects/:id/tree`、`GET/POST/PUT/PATCH/DELETE /projects/:id/file` |
| Git | `GET /projects/:id/git/status`、`POST /projects/:id/git/stage`、`POST /projects/:id/git/unstage`、`POST /projects/:id/git/stage-all`、`POST /projects/:id/git/unstage-all`、`POST /projects/:id/git/commit`、`POST /projects/:id/git/push` |
| 会话 | `POST /projects/:projectId/sessions`、`GET /projects/:projectId/sessions`、`GET/DELETE /sessions/:id`、`GET/POST /sessions/:id/messages`、`POST /sessions/:id/commands` |
| 事件 | `GET /sessions/:id/events?access_token=<jwt>` |
| Agent | `POST /sessions/:id/plan`、`GET /sessions/:id/plans/latest`、`PATCH /plans/:id/answers`、`POST /plans/:id/finalize`、`POST /plans/:id/approve`、`POST /plans/:id/cancel`、`POST /sessions/:id/run` |
| 审批与工具 | `GET /approvals/pending`、`POST /approvals/:id/approve`、`POST /approvals/:id/reject`、`GET /sessions/:id/patches`、`POST /patches/:id/revert`、`GET/POST /sessions/:id/command-runs`、`GET/DELETE /sessions/:id/command-authorization` |
| 命令策略 | `GET /command-policy`、`PATCH /command-policy`、`GET /sessions/:id/allowed-commands` |
| 审计 | `GET /audit-logs` |

`GET /api/system/capabilities` 返回后端版本、`serverMode`、local workspace 是否启用、支持的 workspace modes、source types 和功能开关。`serverMode` 枚举为 `development`、`local_runtime`、`production`，production 模式下 local workspace 必须强制关闭，即使环境变量误开也拒绝。

`POST /api/projects/local` 是 create-or-get 接口。后端校验调用者权限和 serverMode，对 path 执行 realpath；如果同一 ownerId 和 normalized realpath 已存在 local 项目，则返回已有项目，否则创建 sourceType=local、workspaceMode=attached、deletePolicy=db_record_only 的项目记录。

## 7. 关键流程设计

### 7.1 注册与登录

1. 前端提交邮箱、姓名和密码。
2. `AuthService` 使用 bcrypt 哈希密码。
3. `UsersService` 校验邮箱唯一性并创建用户。
4. 若邀请码匹配 `ADMIN_INVITE_CODE`，用户角色为管理员。
5. `JwtService` 签发 JWT，前端保存 Token 并进入工作区。
6. 用户通过 `PATCH /auth/me/preferences` 更新布局和主题偏好，后端归一化宽度范围和主题枚举，前端同时更新本地主题缓存。

### 7.2 模型连接

1. 用户在设置页手动创建模型配置，或在会话中输入 `/connect`。
2. `ModelConfigsService` 根据 Provider 预设或自定义输入解析 base URL。
3. 后端调用 Provider 的 `/models` 接口校验 API Key 和模型可用性。
4. API Key 通过 `EncryptionService` 使用 AES-256-GCM 加密保存。
5. 返回前端的模型配置经过 sanitize，不包含密钥。

### 7.3 项目导入与文件访问

1. 用户创建 managed 项目后，`PathSandboxService` 为项目创建独立工作区目录。
2. Git 导入使用 `git clone --depth 1`，可指定分支。
3. ZIP 导入解析中心目录，拒绝 Zip64、加密归档、目录穿越、绝对路径、重复路径和过大归档。
4. 文件读取、保存、删除和重命名都通过 `resolveProjectPath` 解析路径，保证目标仍在项目根目录内；local 项目也使用同一套 sandbox 约束。
5. 文件操作写入审计日志。

### 7.4 TUI 本机工作区绑定

1. 用户在本机仓库中执行 `mebius` 或 `mebius /path/to/project`。
2. TUI 读取配置，连接已运行的 API，并调用 `GET /api/system/capabilities`。
3. 若 API 是 localhost、后端 serverMode 不是 production、local workspace 已启用且用户为管理员，TUI 调用 `POST /api/projects/local`。
4. 后端通过 LocalWorkspaceGuard 检查 local workspace 开关和管理员权限，通过 PathSandboxService 校验绝对路径、目录存在性、危险目录和 realpath。
5. 后端以 ownerId + normalized realpath 查找已有项目，存在则返回，不存在则创建 attached local 项目。
6. TUI 获取项目会话列表，没有会话时创建新 session，然后订阅 SSE 并进入工作台。
7. 若 API 是远程地址，TUI 不提交本机 path，只从远程后端已有项目中选择工作区。

### 7.5 Plan Mode 生命周期

1. 用户在 Web 或 TUI 提交目标，`POST /sessions/:id/plan` 创建 `planning_generating` 计划；TUI 传入 `clientRequestId`，后端按 session + clientRequestId 返回已有计划，避免重试重复生成。
2. `AgentService` 调用模型生成严格 JSON，包括 summary、markdown、steps 和 questions；questions 为空时进入 `plan_ready_pending_approval`，否则进入 `plan_customizing`。
3. 客户端通过 `PATCH /plans/:id/answers` 保存澄清答案，答案结构支持单选、多选、自定义回答和备注。
4. 用户确认答案后调用 `POST /plans/:id/finalize`，后端结合草案、步骤和答案生成最终计划，保存 `finalMarkdown` 并进入 `plan_review`。
5. 用户通过 `POST /plans/:id/approve` 批准待批准或审查中的计划；后端把最终计划快照写入会话消息，并将计划置为 `approved`。
6. 用户可以通过 `POST /plans/:id/cancel` 取消未批准计划；旧数据库状态 `pending_approval`、`rejected`、`running` 和 `completed` 在读取时归一化为当前状态。

### 7.6 Agent 执行与工具循环

1. 用户发送消息或执行已批准计划后，`AgentService` 读取会话摘要和最近消息，构造模型上下文。
2. 系统将当前项目允许的命令前缀、后端运行平台和 shell 类型注入 system prompt 与 `run_command` 工具描述。
3. `OpenAiCompatibleService` 流式调用模型，并通过 SSE 推送 token。
4. 模型返回工具调用时，Agent 解析 JSON 参数并交给 `ToolsService`。
5. 只读工具直接执行，结果作为 tool message 写入会话并继续模型回合。
6. 写入补丁或未授权命令执行会生成待审批记录，Agent 暂停并等待用户批准。
7. 用户批准后，系统执行工具、记录结果，再由 Agent 恢复模型回合。
8. 达到最大工具轮数仍未完成时，系统保存提示消息并标记最新运行中的计划失败。

### 7.7 补丁应用与回滚

1. `create_patch` 接收单文件或多文件完整目标内容。
2. 系统保存原始内容、目标内容和 Diff，状态为 `proposed`。
3. 用户批准时，系统重新读取当前文件内容并与原始快照比较。
4. 内容一致则写入文件并将补丁标记为 `applied`。
5. 内容不一致则标记为 `conflicted`，不写入文件。
6. 用户回滚补丁时，系统要求当前文件仍等于补丁后的内容；否则拒绝回滚。

### 7.8 命令执行与策略

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

### 7.9 Git 发布

1. `ProjectsService` 通过 `git status --short --branch` 获取分支、跟踪分支和文件状态。
2. 系统检查当前项目根目录本身是否为 Git 仓库，避免误用父目录仓库。
3. 用户可以 stage、unstage、commit、push。
4. commit 前要求存在已暂存改动，push 前要求存在远端和可推送提交。
5. Git 操作均写入审计日志。

## 8. 安全设计

- 认证安全：所有业务接口使用 JWT Guard；SSE 使用 `access_token` 查询参数配合专用 Guard。
- 密码安全：密码使用 bcrypt 哈希，不保存明文。
- 密钥安全：模型 API Key 使用主密钥派生的 AES-256-GCM 加密；响应中永不返回明文。
- 路径安全：managed 项目和 local 项目统一通过 `PathSandboxService` 校验。已存在路径使用 realpath 检查仍在 workspaceRoot 内；新建文件检查父目录 realpath；禁止符号链接逃逸 workspaceRoot。
- local workspace 安全：local workspace 默认关闭，只在非 production 且 `MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true` 时可用；production 模式强制拒绝；创建 local 项目需要管理员权限；删除 local 项目只删除数据库记录。
- 目录屏蔽：`.git`、`.env`、`node_modules`、`dist`、`coverage` 默认不可访问；真实本地仓库文件树还默认忽略 `build`、`.next`、`.nuxt`、`.cache`、`.venv`、`venv`、`__pycache__`、`.pytest_cache`、`datasets`、`models`、`outputs`、`checkpoints`。
- 命令安全：常规命令必须匹配策略前缀；策略外命令和 shell 命令需要审批或会话授权；命令替换、反引号和换行被硬性拒绝；所有命令都在工作区内执行。
- 人工审批：补丁写入和未授权命令执行需要用户审批，会话级命令自动执行授权可撤销并写入审计。
- 审计追踪：高风险和关键状态变更写入审计日志。

## 9. 部署设计

本地和服务器部署使用 Docker Compose。根目录 `docker-compose.yml` 启动：

- `postgres`：PostgreSQL 数据库，端口 `5432`。
- `api`：NestJS 后端，端口 `3000`。

后端通过环境变量配置数据库连接、JWT 密钥、API Key 加密主密钥、工作区根目录、命令白名单和管理员邀请码。前端开发环境由 Vite 启动在 `http://127.0.0.1:5173`，并将 `/api` 代理到后端。

TUI 本机测试时，MVP 要求手动启动 PostgreSQL 和 NestJS API，不由 `mebius` 自动拉起后端。local workspace 需要设置 `MEBIUS_CODE_SERVER_MODE=local_runtime` 和 `MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true`，且不能使用 production API 容器绑定 Windows 或用户本机路径。远程 API 模式下，TUI 只操作远程后端已有 workspace。

## 10. UML 图

UML 源文件位于 `docs/diagrams/`：

- `use-case.puml`：展示普通开发者和管理员的系统用例。
- `package.puml`：展示后端模块依赖。
- `domain-class.puml`：展示核心领域实体及关系。
- `deployment.puml`：展示浏览器、前端、后端、数据库、工作区、Git 和模型 Provider 的部署关系。

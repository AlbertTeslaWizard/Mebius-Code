# Mebius Code 系统设计文档

## 1. 技术选型

| 层次 | 技术 | 设计理由 |
| --- | --- | --- |
| 后端框架 | NestJS + TypeScript | 使用类、装饰器、依赖注入、模块和服务组织业务逻辑，适合面向对象课程设计表达 |
| 前端框架 | Vue 3 + TypeScript + Vite | 构建单页 Web 客户端，类型约束明确，开发和演示成本低 |
| 状态管理 | Pinia | 将认证、工作区、审批、本地化等客户端状态模块化 |
| UI 与编辑 | Naive UI、Tailwind CSS、CodeMirror、Shiki、Markdown-it、DOMPurify | 支持工作台界面、代码编辑、代码高亮、Markdown 消息和安全渲染 |
| 数据库 | PostgreSQL | 保存用户、模型配置、项目、会话、消息、计划、审批和审计记录 |
| ORM | TypeORM | 以实体类映射数据库表，便于表达领域对象关系 |
| 认证 | JWT + Passport | 支持 Web 客户端无状态访问受保护接口 |
| 实时事件 | Server-Sent Events | 将模型 token、工具状态、审批、命令输出等事件推送到浏览器 |
| 模型接入 | OpenAI-compatible Chat Completions API | 兼容多个模型 Provider 和工具调用协议 |
| 部署 | Docker Compose | 本地和服务器演示环境都能快速启动 PostgreSQL 与 API 服务 |

## 2. 总体架构

系统采用“前后端分离 + 模块化单体后端”的架构。后端当前是一个 NestJS 应用，但模块边界按照未来微服务拆分方向设计；前端是 Vue 单页应用，通过 REST API 和 SSE 与后端通信。

```text
Browser Web App
  ├── Auth / Workspace / Settings Views
  ├── Pinia Stores
  └── REST + SSE Client

NestJS API
  ├── Auth / Users
  ├── Model Configs
  ├── Projects
  ├── Sessions
  ├── Agent
  ├── Tools
  ├── Events
  └── Audit

External / Runtime Resources
  ├── PostgreSQL
  ├── Project Workspace Root
  ├── Git / Node / Python Commands
  └── OpenAI-compatible Providers
```

后端模块职责如下：

| 模块 | 职责 |
| --- | --- |
| `auth` | 注册、登录、JWT 签发、当前用户查询、偏好更新 |
| `users` | 用户实体、邮箱唯一性、密码哈希、角色和偏好合并 |
| `model-configs` | 模型配置 CRUD、Provider 预设搜索、连接校验、API Key 加密 |
| `projects` | 项目 CRUD、工作区路径维护、Git/ZIP 导入、文件 API、Git 发布操作 |
| `sessions` | 会话、消息、上下文摘要、Slash Command 和当前 Agent 活动 |
| `agent` | Plan Mode、模型调用、工具循环、工具审批后的恢复执行 |
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
| `auth` | 保存用户、Token、登录注册、退出、偏好更新 |
| `workspace` | 保存项目、会话、消息、文件树、当前文件、计划、补丁、命令运行、Git 状态和 SSE 状态 |
| `approvals` | 查询待审批工具调用，执行批准或拒绝 |
| `locale` | 中英文界面文本 |

### 3.3 关键组件

- `WorkspaceFileTree`：展示项目文件树，触发文件选择、重命名和删除。
- `CodeEditor`：使用 CodeMirror 编辑当前文本文件。
- `CodePreview`：使用 Shiki 高亮展示代码。
- `DiffPreview`：展示 Agent 生成补丁的差异。
- `MessageContent`：渲染 Markdown 消息，并通过 DOMPurify 做 HTML 净化。

## 4. 数据设计

核心实体及关系如下：

| 实体 | 关键字段 | 关系 |
| --- | --- | --- |
| `User` | email、name、passwordHash、role、preferences | 拥有模型配置、项目、会话和审计记录 |
| `ModelConfig` | displayName、baseUrl、modelName、providerId、encryptedApiKey、supportsTools、isDefault | 属于一个用户，可作为会话活动模型 |
| `Project` | name、description、sourceType、gitUrl、workspacePath | 属于一个用户，包含多个会话 |
| `Session` | title、status、activeModelConfig | 属于用户和项目，包含消息、计划、工具调用 |
| `Message` | role、content、metadata | 属于会话，用于还原模型上下文 |
| `ConversationSummary` | content、tokenEstimate | 属于会话，用于 `/compact` |
| `Plan` | summary、status | 属于会话，包含多个步骤 |
| `PlanStep` | order、title、detail、status | 属于计划 |
| `ToolCall` | name、arguments、status、requiresApproval、resultText | 属于会话，可关联审批、补丁和命令运行 |
| `ToolApproval` | status、reason、requester、approver | 关联一个工具调用 |
| `FilePatch` | relativePath、originalContent、patchedContent、diffText、status | 记录补丁提议、应用、冲突、拒绝和回滚 |
| `CommandRun` | command、cwd、exitCode、stdout、stderr、status | 记录命令执行过程和结果 |
| `CommandPolicyConfig` | enabledPresets、customCommands | 保存全局命令策略 |
| `ProjectCommandPermission` | command | 保存管理员授权的项目级命令 |
| `AuditLog` | action、resourceType、resourceId、metadata | 记录关键业务操作 |

## 5. API 设计

后端全局前缀为 `/api`，接口分组如下：

| 分组 | 主要接口 |
| --- | --- |
| 健康检查 | `GET /health` |
| 认证 | `POST /auth/register`、`POST /auth/login`、`GET /auth/me`、`PATCH /auth/me/preferences` |
| 模型配置 | `GET/POST /model-configs`、`PATCH/DELETE /model-configs/:id`、`POST /model-configs/:id/test` |
| 项目 | `GET/POST /projects`、`DELETE /projects/:id`、`POST /projects/:id/import/git`、`POST /projects/:id/import/archive` |
| 文件 | `GET /projects/:id/tree`、`GET/POST/PUT/PATCH/DELETE /projects/:id/file` |
| Git | `GET /projects/:id/git/status`、`POST /projects/:id/git/stage`、`POST /projects/:id/git/unstage`、`POST /projects/:id/git/stage-all`、`POST /projects/:id/git/unstage-all`、`POST /projects/:id/git/commit`、`POST /projects/:id/git/push` |
| 会话 | `POST /projects/:projectId/sessions`、`GET /projects/:projectId/sessions`、`GET/DELETE /sessions/:id`、`GET/POST /sessions/:id/messages`、`POST /sessions/:id/commands` |
| 事件 | `GET /sessions/:id/events?access_token=<jwt>` |
| Agent | `POST /sessions/:id/plan`、`GET /sessions/:id/plans/latest`、`POST /plans/:id/approve`、`POST /sessions/:id/run` |
| 审批与工具 | `GET /approvals/pending`、`POST /approvals/:id/approve`、`POST /approvals/:id/reject`、`GET /sessions/:id/patches`、`POST /patches/:id/revert`、`GET/POST /sessions/:id/command-runs` |
| 命令策略 | `GET /command-policy`、`PATCH /command-policy`、`GET /sessions/:id/allowed-commands` |
| 审计 | `GET /audit-logs` |

## 6. 关键流程设计

### 6.1 注册与登录

1. 前端提交邮箱、姓名和密码。
2. `AuthService` 使用 bcrypt 哈希密码。
3. `UsersService` 校验邮箱唯一性并创建用户。
4. 若邀请码匹配 `ADMIN_INVITE_CODE`，用户角色为管理员。
5. `JwtService` 签发 JWT，前端保存 Token 并进入工作区。

### 6.2 模型连接

1. 用户在设置页手动创建模型配置，或在会话中输入 `/connect`。
2. `ModelConfigsService` 根据 Provider 预设或自定义输入解析 base URL。
3. 后端调用 Provider 的 `/models` 接口校验 API Key 和模型可用性。
4. API Key 通过 `EncryptionService` 使用 AES-256-GCM 加密保存。
5. 返回前端的模型配置经过 sanitize，不包含密钥。

### 6.3 项目导入与文件访问

1. 用户创建项目后，`PathSandboxService` 为项目创建独立工作区目录。
2. Git 导入使用 `git clone --depth 1`，可指定分支。
3. ZIP 导入解析中心目录，拒绝 Zip64、加密归档、目录穿越、绝对路径、重复路径和过大归档。
4. 文件读取、保存、删除和重命名都通过 `resolveProjectPath` 解析路径，保证目标仍在项目根目录内。
5. 文件操作写入审计日志。

### 6.4 Agent 执行与工具循环

1. 用户发送消息或批准计划后，`AgentService` 读取会话摘要和最近消息，构造模型上下文。
2. 系统将当前项目允许的命令前缀注入 `run_command` 工具描述。
3. `OpenAiCompatibleService` 流式调用模型，并通过 SSE 推送 token。
4. 模型返回工具调用时，Agent 解析 JSON 参数并交给 `ToolsService`。
5. 只读工具直接执行，结果作为 tool message 写入会话并继续模型回合。
6. 写入补丁或命令执行会生成待审批记录，Agent 暂停并等待用户批准。
7. 用户批准后，系统执行工具、记录结果，再由 Agent 恢复模型回合。
8. 达到最大工具轮数仍未完成时，系统保存提示消息并标记计划失败。

### 6.5 补丁应用与回滚

1. `create_patch` 接收单文件或多文件完整目标内容。
2. 系统保存原始内容、目标内容和 Diff，状态为 `proposed`。
3. 用户批准时，系统重新读取当前文件内容并与原始快照比较。
4. 内容一致则写入文件并将补丁标记为 `applied`。
5. 内容不一致则标记为 `conflicted`，不写入文件。
6. 用户回滚补丁时，系统要求当前文件仍等于补丁后的内容；否则拒绝回滚。

### 6.6 命令执行与策略

1. `CommandPolicyService` 将命令标准化，并拒绝管道、重定向、命令链、命令替换和换行。
2. 系统先检查环境白名单、管理员启用的预设、自定义命令和项目级授权命令。
3. 普通用户请求策略外命令时直接失败。
4. 管理员可以单次批准策略外命令，或批准后记入项目级权限。
5. 命令通过 `spawn` 在项目工作区执行，输出和退出码写入 `CommandRun`。

### 6.7 Git 发布

1. `ProjectsService` 通过 `git status --short --branch` 获取分支、跟踪分支和文件状态。
2. 系统检查当前项目根目录本身是否为 Git 仓库，避免误用父目录仓库。
3. 用户可以 stage、unstage、commit、push。
4. commit 前要求存在已暂存改动，push 前要求存在远端和可推送提交。
5. Git 操作均写入审计日志。

## 7. 安全设计

- 认证安全：所有业务接口使用 JWT Guard；SSE 使用 `access_token` 查询参数配合专用 Guard。
- 密码安全：密码使用 bcrypt 哈希，不保存明文。
- 密钥安全：模型 API Key 使用主密钥派生的 AES-256-GCM 加密；响应中永不返回明文。
- 路径安全：相对路径标准化后必须位于项目根目录内，拒绝绝对路径和 `..`。
- 目录屏蔽：`.git`、`.env`、`node_modules`、`dist`、`coverage` 默认不可访问。
- 命令安全：命令必须匹配策略前缀，不允许 shell 组合语法，并在工作区内执行。
- 人工审批：补丁和命令执行均需要用户审批。
- 审计追踪：高风险和关键状态变更写入审计日志。

## 8. 部署设计

本地和服务器部署使用 Docker Compose。根目录 `docker-compose.yml` 启动：

- `postgres`：PostgreSQL 数据库，端口 `5432`。
- `api`：NestJS 后端，端口 `3000`。

后端通过环境变量配置数据库连接、JWT 密钥、API Key 加密主密钥、工作区根目录、命令白名单和管理员邀请码。前端开发环境由 Vite 启动在 `http://127.0.0.1:5173`，并将 `/api` 代理到后端。

## 9. UML 图

UML 源文件位于 `docs/diagrams/`：

- `use-case.puml`：展示普通开发者和管理员的系统用例。
- `package.puml`：展示后端模块依赖。
- `domain-class.puml`：展示核心领域实体及关系。
- `deployment.puml`：展示浏览器、前端、后端、数据库、工作区、Git 和模型 Provider 的部署关系。

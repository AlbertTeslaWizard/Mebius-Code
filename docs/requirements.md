# Mebius Code 系统需求文档

## 1. 项目背景与可行性

Mebius Code 是面向开发者的智能编程 Agent 平台。系统以大语言模型为核心，通过 Web 客户端、服务端代码工作区、工具调用、人工审批和审计机制，帮助开发者完成需求分析、计划制定、代码阅读、文件修改、命令执行、Git 提交和上下文管理等任务。

课程要求系统具备 Server 端和至少一种 Client 端，并体现智能化能力。本项目采用 NestJS 后端、Vue 3 Web 前端、Bun/OpenTUI/Solid 终端 TUI、Kotlin/Jetpack Compose Android 伴随客户端、PostgreSQL 数据库和 OpenAI-compatible 模型接口，能够在个人课程项目规模内实现完整的“登录 - 配置模型 - 创建项目 - Agent 协作 - 审批执行 - 审计追踪”闭环。

项目具备以下可行性：

- 技术可行：NestJS、TypeORM、Vue、Vite、Docker Compose 均为成熟技术栈，适合快速构建可演示系统。
- 业务可行：智能编程助手的核心流程明确，需求边界可以控制在代码工作区和会话协作范围内。
- 安全可行：通过路径沙箱、命令策略、API Key 加密、人工审批和审计日志降低 Agent 自动执行带来的风险。
- 文档可行：系统中的用户、项目、会话、计划、工具调用、审批和审计天然适合用面向对象方法进行类建模、包建模和交互建模。

## 2. 领域边界

系统聚焦于“智能编程辅助”领域，不覆盖完整商业 IDE、通用办公聊天、企业级 DevOps 平台或云端 CI/CD 平台。当前边界包括：

- 用户注册登录、角色和界面偏好管理。
- 多模型 Provider 配置、连接测试和会话模型切换。
- 服务端项目工作区的创建、导入、绑定、文件浏览、文本编辑和 Git 操作。
- Agent 会话、消息历史、Plan Mode、流式响应和上下文清理。
- 文件列表、文件读取、文本搜索、补丁生成和命令执行等编码工具。
- 公共 Web 检索、远程 MCP 工具和仓库级项目指令，为 Agent 提供最新外部资料和项目约定上下文。
- 高风险工具的人机审批、补丁回滚、命令策略和审计记录。
- 回合级撤销/重做、会话删除事件同步和计划讨论/修订流程，降低 Agent 回合执行后的恢复成本。
- Web 前端保留后端托管工作区模式，TUI 作为第二客户端支持在后端本机绑定真实本地仓库，Android 作为轻量移动伴随客户端支持查看任务、会话和待审批项。
- 后端通过系统能力接口向客户端声明版本、运行模式、工作区模式和 local workspace 能力。

## 3. 目标用户与角色

| 角色 | 说明 | 主要诉求 |
| --- | --- | --- |
| 普通开发者 | 使用系统进行代码阅读、修改和测试的用户 | 配置模型、导入项目、发起会话、审批 Agent 操作 |
| 学生开发者 | 在课程项目中使用 AI 完成工程化开发任务的用户 | 保留开发记录、解释设计、展示智能化能力 |
| 管理员 | 通过邀请码注册获得管理员角色的用户 | 管理命令策略、查看全局审计日志、授权项目命令 |

## 4. 竞品分析

| 产品 | 优势 | 局限 | Mebius Code 的定位 |
| --- | --- | --- | --- |
| Claude Code | CLI 体验成熟，适合本地项目协作 | 主要围绕 Claude 模型生态 | 参考其 Agentic Coding 工作流，但保留多 Provider 配置 |
| OpenCode | 支持多模型 Provider 和服务端模式 | 学习和部署成本较高 | 借鉴开放模型接入和工具化执行思路 |
| Codex | 强调 Plan Mode、工具调用和审批 | 产品形态和课程交付要求不同 | 将 Agent 工作流落到课程项目可解释、可建模的系统中 |

Mebius Code 的课程项目优势是范围清晰、功能闭环完整、面向对象建模对象丰富；劣势是功能深度、插件生态和商业级稳定性无法与成熟产品相比。

## 5. 总体功能分解

```text
Mebius Code
├── 用户与权限
│   ├── 注册登录
│   ├── JWT 鉴权
│   ├── 普通用户 / 管理员角色
│   ├── 界面布局偏好
│   └── 明暗主题偏好
├── 模型配置
│   ├── OpenAI-compatible Provider 预设
│   ├── 自定义 Provider
│   ├── API Key 加密存储
│   ├── 连接测试
│   ├── /connect 引导配置
│   └── 会话模型切换
├── 项目工作区
│   ├── 创建和删除项目
│   ├── Git 仓库导入
│   ├── ZIP 压缩包导入
│   ├── 本机 local workspace 绑定
│   ├── managed / attached 工作区模式
│   ├── 文件树浏览
│   ├── 文件读取、创建、保存、删除、重命名
│   └── Git 状态、暂存、提交和推送
├── Agent 会话
│   ├── 创建、查询、删除会话
│   ├── 对话历史
│   ├── SSE 流式输出
│   ├── Plan Mode
│   ├── Plan 讨论与修订
│   ├── /clear 和 /compact
│   ├── /undo 和 /redo
│   └── Agent 活动状态展示
├── 工具调用
│   ├── list_files
│   ├── read_file
│   ├── search_text
│   ├── web_search
│   ├── create_patch
│   ├── run_command
│   └── MCP 动态工具
├── 技能系统
│   ├── 技能发现与扫描
│   ├── 技能浏览与详情
│   ├── 技能选择与注入
│   ├── /skills 命令
│   └── 活动技能上下文传递
├── 终端 TUI 客户端
│   ├── mebius 启动命令
│   ├── login / logout / doctor
│   ├── 当前目录或显式路径绑定
│   ├── SSE 流式输出
│   ├── /init 项目指令生成
│   ├── MCP 浏览与管理
│   └── 审批、Diff 和命令运行预览
├── Android 伴随客户端
│   ├── 连接已有 Mebius API
│   ├── 设置页 API 地址调整和登出
│   ├── 项目、最近会话和待审批概览
│   ├── 会话打开、重命名、删除和新建
│   ├── Build / Plan 消息提交
│   ├── SSE 状态与流式内容展示
│   ├── Markdown/数学公式消息渲染
│   └── 计划卡片和工具审批处理
└── 安全与审计
    ├── 工具审批
    ├── Diff 和命令预览
    ├── 补丁回滚
    ├── 路径沙箱
    ├── 命令白名单和预设
    ├── 项目级命令授权
    ├── 会话级 Shell 命令授权
    └── 操作日志
```

## 6. 功能性需求

### 6.1 用户与权限

- 用户可以先请求注册邮箱验证码，再通过邮箱、姓名、密码和 6 位验证码注册账号。
- 注册验证码应通过 SMTP 邮件发送，10 分钟内有效，支持重发冷却、单邮箱频率限制、全局发送上限和最大校验次数限制。
- 用户可以登录并获得 JWT，用于后续访问受保护接口。
- 系统支持管理员邀请码，输入正确邀请码的注册用户获得管理员角色。
- 用户可以查询当前账号信息。
- 用户可以保存界面布局偏好，包括左右侧栏折叠状态和宽度、Web 会话栏折叠状态。
- 用户可以保存明暗主题偏好，系统应在登录后恢复用户偏好，并在本地缓存中保留当前主题选择。
- 未登录用户访问工作区、模型设置、命令设置和审计页面时应跳转到登录页。

### 6.2 模型配置

- 用户可以新增、查询、修改、删除自己的模型配置。
- 系统支持 OpenAI、OpenRouter、DeepSeek、Moonshot AI、DashScope、SiliconFlow 和自定义 OpenAI-compatible Provider。
- 系统应支持按英文、中文别名搜索 Provider。
- 用户可以通过 `/connect` 在会话中搜索 Provider、填写 API Key、校验可用模型并自动切换当前会话模型。
- API Key 必须加密保存，不得在前端响应、审计日志或错误信息中明文暴露。
- 用户可以设置默认模型配置，并在会话中通过 `/model` 切换模型。

### 6.3 项目工作区

- 用户可以创建项目并获得独立服务端工作区。
- 用户只能访问自己创建的项目。
- 项目工作区分为 managed workspace 和 attached workspace。manual、git、archive 项目属于 managed workspace，由后端托管目录；local 项目属于 attached workspace，绑定后端运行机器上的既有真实目录。
- 项目模型应记录 `sourceType`、`workspaceMode`、`workspacePath` 和 `deletePolicy`。旧 manual/git/archive 项目默认 `workspaceMode=managed`、`deletePolicy=delete_managed_files_allowed`。
- 用户可以删除 managed 项目，系统应同时删除对应沙箱工作区；删除 local 项目时只能删除数据库记录，绝不能删除真实本地目录。
- 用户可以从远端 Git 仓库导入代码，可指定分支。
- 用户可以上传 `.zip` 压缩包导入代码，系统应拒绝过大、路径不安全或包含目录穿越的归档。
- 本机运行模式下，管理员可以通过 `POST /api/projects/local` 创建或获取 local 项目。接口对输入路径执行 `realpath`，并以 ownerId + 标准化真实路径作为唯一性依据，避免同一目录重复绑定。
- local workspace 路径语义是“后端运行机器可访问的本地路径”，不是浏览器或远程 TUI 客户端机器上的路径。远程 API 模式不得把客户端本机路径注册为 local 项目。
- local workspace 默认关闭，只能在非 production 且 `MEBIUS_CODE_LOCAL_WORKSPACES_ENABLED=true` 时启用；创建 local 项目需要管理员权限并通过 LocalWorkspaceGuard。
- local workspace 路径必须是绝对路径、存在且为目录，必须拒绝 `/`、`/etc`、`/usr`、Windows 盘符根目录、`C:\Windows` 等危险系统目录。
- 用户可以查看项目文件树，系统应隐藏 `.git`、`.env`、`node_modules`、`dist`、`coverage` 等敏感或生成目录；TUI 默认还应忽略 `build`、`.next`、`.nuxt`、`.cache`、`.venv`、`venv`、`__pycache__`、`.pytest_cache`、`datasets`、`models`、`outputs`、`checkpoints` 等大型目录。
- 用户可以读取、创建、保存、删除和重命名工作区中的文本文件。
- 系统应支持读取项目根目录 `AGENTS.md` 作为仓库级 Agent 指令，最多读取 32KB，并在模型上下文中作为低于系统/开发者指令的项目约定。
- 用户可以通过 `/init` 生成 `AGENTS.md` 初稿，支持预览、不覆盖已有文件和显式替换已有文件；创建或替换应写入审计日志。
- 系统应限制通过 API 读取或写入过大的文本文件。
- 所有文件读写、文件树遍历、补丁应用、Git 操作和命令工作目录都必须通过路径沙箱校验；已存在路径检查 realpath，新建文件检查父目录 realpath，并禁止符号链接逃逸工作区根目录。
- 对 Git 项目，用户可以查看分支、远端、ahead/behind、可推送提交数和文件状态。
- 用户可以暂存单个文件、取消暂存单个文件、暂存全部、取消暂存全部、提交和推送。

### 6.4 Agent 会话

- 用户可以在项目内创建多个编码会话。
- 用户可以查看会话列表、会话详情和消息历史。
- 用户可以按项目搜索历史会话并切换进入某个会话继续对话；同一后端、同一用户、同一项目下的会话列表应在 Web 客户端和 TUI 客户端之间保持一致。
- 用户可以删除会话。
- 用户发送普通消息后，后端应调用配置好的模型并通过 SSE 向前端推送 token、状态和工具事件。
- 客户端收到回合结束 `done` 事件后，应重新加载服务端持久化消息；Web 和 TUI 应同步刷新计划、补丁、命令运行和审批数据，避免流式临时消息与最终 transcript 不一致。
- 系统应在存在待审批工具调用时阻止用户继续发送新的 Agent 消息，避免上下文冲突。
- 用户可以使用 Plan Mode 提交目标并生成计划草案；计划应保存目标、摘要、步骤、草案正文和可选澄清问题，生成期间状态为 `planning_generating`。
- 当计划包含澄清问题时，用户可以提交或修订单选、多选和自定义答案，系统据此定稿并进入 `plan_review` 审查状态；无需澄清的问题可直接进入 `plan_ready_pending_approval` 待批准状态。
- 用户可以批准处于 `plan_ready_pending_approval` 或 `plan_review` 状态的计划，批准时系统应保存最终计划快照并将计划置为 `approved`；只有已批准计划才能作为 Agent 执行依据，未批准计划可以取消。
- 用户可以在计划执行前继续讨论计划、提出修订要求或取消计划；讨论只产生会话消息，修订会重新生成计划草案、步骤和澄清问题，并回到可定制、审查或待批准状态。
- 已批准计划执行时应通过 `approvedPlanId` 关联计划，后端应校验计划属于当前会话且状态为 `approved`；TUI 在计划批准后应切回 Build 模式，避免后续实现请求被误作为新计划。
- 系统应将旧数据库状态 `pending_approval` 归一化为 `plan_ready_pending_approval`，将 `running` 和 `completed` 归一化为 `approved`，保证客户端始终看到当前状态词汇。
- Plan Mode 创建接口应支持 `clientRequestId` 幂等标识，避免客户端重试导致同一会话生成重复计划。
- 用户重新进入会话时，已被处理（批准、取消或失败）的计划不应再次显示审批界面；系统应跟踪已处理的计划决定 ID 并在会话切换时跳过过期审批面板。
- `/clear` 应清空当前会话消息。
- `/compact` 应生成上下文摘要并清空原始消息，后续模型调用应携带摘要。
- `/undo` 应撤销最近一个可撤销 Agent 回合，软删除该回合消息，并在补丁快照无冲突时回滚该回合产生的补丁。
- `/redo` 应重做最近一个已撤销回合，恢复该回合消息，并在补丁快照无冲突时重新应用对应补丁。
- 撤销或重做计划相关回合时，系统应同步更新计划可见状态，并通过 `turn_undone`、`turn_redone` 和 `plan_updated` 事件通知客户端刷新。
- 用户删除会话时，系统应发布 `session_deleted` 状态，让客户端停止旧 SSE 流并允许连续删除会话。

### 6.5 工具调用与审批

- Agent 可以调用 `list_files` 获取项目文件结构。
- Agent 可以调用 `read_file` 读取指定文本文件。
- Agent 可以调用 `search_text` 搜索项目文本内容。
- Agent 可以调用 `web_search` 检索公共 Web 信息，用于近期文档、版本、新闻、价格或可能变化的事实；查询不得包含密钥、token 或私有文件内容，返回结果必须作为不可信资料处理并保留来源 URL。
- Agent 可以调用 `create_patch` 生成单文件或多文件补丁。
- Agent 可以调用 `run_command` 请求在工作区执行命令，工具描述应包含后端运行平台和 shell 类型。
- Agent 可以调用由已启用 MCP Server 动态暴露的工具，工具名格式为 `mcp__<serverSlug>__<toolName>`；只读 MCP 工具可直接执行，非只读或破坏性工具必须进入审批流程。
- 当模型调用了不在已知工具列表中的工具名时，系统应返回友好提示消息告知可用工具，并将该工具调用标记为失败后继续回合，而不是中断会话或崩溃。
- 只读工具可以直接执行。
- `create_patch` 必须进入审批流程；`run_command` 在无会话自动执行授权时进入审批流程。
- 前端应展示补丁 Diff、命令、工作目录、策略来源、执行模式、Shell token 和会话授权状态等预览信息。
- 用户可以批准或拒绝审批；对命令审批可以选择仅运行本次，或信任当前会话并自动执行后续命令。
- 用户批准 `run_command` 或 `create_patch` 时可以创建当前会话级审批规则，让后续匹配的同类工具在当前会话内自动执行；该规则不得越过工作区边界。
- 用户批准补丁后，系统应在应用前检查源文件快照，发现冲突时拒绝写入。
- 用户可以回滚已经应用且尚未被再次修改的补丁。
- 命令执行结果应记录 stdout、stderr、退出码和状态。
- 工作区运行面板在未信任会话时按当前项目可用命令生成下拉选项；信任会话后允许自由输入命令，并仍限制工作目录不得逃逸项目沙箱。

### 6.6 技能系统

- 系统应支持技能（Skill）发现、浏览、选择和注入能力，允许用户将技能上下文传递给 Agent 或 Plan 以增强其行为。
- 技能来源于多个目录，按优先级依次为：`.mebius/skills/`（工作区级，最高优先级）、`.opencode/skills/`（工作区级）、`.claude/skills/`（工作区级）、`~/.claude/skills/`、`~/.claude/plugins/cache/`、`~/.claude/plugins/marketplaces/`、`~/.config/opencode/skills/`、`~/.opencode/skills/`（全局级）、以及用户通过 `preferences.skillDirs` 配置的自定义目录。
- 每个技能为一个包含 `SKILL.md` 文件的目录，`SKILL.md` 可包含 YAML frontmatter（`name`、`description`、`summary`）和正文内容。
- 技能发现应按目录优先级去重，工作区级技能优先于同名的全局技能。
- 技能发现应跳过 `.git`、`node_modules`、`dist`、`build` 等目录，并拒绝符号链接逃逸。
- 活动技能上下文应包含 `name`（技能名称）、`source`（技能来源，枚举值为 `workspace`、`user`、`opencode`、`claude`、`mebius`、`custom`）、`skillFile`（技能文件路径，可选）和 `content`（技能正文内容）字段。
- 用户每次运行 Agent 或创建 Plan 最多可注入 3 个活动技能。
- 注入的活动技能将以系统消息形式添加到模型上下文中，告知模型当前活动技能的名称、来源和内容，并明确声明只可使用已注册工具。
- 远程 API 模式下，TUI 不应扫描或提交本机技能文件，而应明确提示技能发现仅在本机模式下可用。

### 6.7 命令策略与权限

- 系统应支持环境变量中的不可变命令白名单。
- 管理员可以启用 Git、Node.js、Python 预设命令。
- 管理员可以配置自定义命令前缀，且自定义前缀不得包含 shell 组合语法。
- 用户可以通过 `/permissions` 查询或切换当前会话的权限模式，影响工具是否直接执行、进入审批或被拒绝。
- 系统应提供当前会话可用命令查询能力，便于前端提前过滤常规可运行命令。
- 策略外命令不应在创建审批前直接失败，而应进入命令审批流程。
- 命令链、重定向和管道应被识别为 shell 执行模式，需要用户审批或当前会话授权。
- 命令替换、反引号和换行应作为硬性高风险语法拒绝。
- 用户可以为当前会话开启命令自动执行授权；该授权只作用于当前会话，可撤销，并应写入审计日志。
- 系统应保留向后兼容的会话 Shell 自动执行授权，同时支持更细粒度的会话审批规则，用于记住当前会话内被批准的命令或补丁工具操作。
- 管理员可以将非 shell 命令授权为当前项目可复用命令；shell 命令不得保存为项目级命令前缀。
- 系统应将后端运行平台和 shell 类型注入 Agent 上下文，例如 Windows 使用 `cmd.exe`，Linux/macOS 使用 `/bin/sh`。
- 所有命令都必须在项目工作区内执行，工作目录不得逃逸项目沙箱。

### 6.8 审计日志

- 系统应记录项目创建、导入、删除、文件修改、Git 操作、补丁应用、补丁回滚、命令执行和命令授权等关键操作。
- 普通用户只能查看自己的审计日志。
- 管理员可以按操作者、动作、资源类型、资源 ID 分页查询审计日志。

### 6.9 Web 客户端

- Web 客户端应提供登录、注册、工作区、模型设置、命令权限设置和审计日志页面。
- 工作区应包含项目列表、会话列表、文件树、代码查看与编辑、聊天区、Plan 区、审批区、补丁区、命令运行区和 Git 发布区。
- 工作区的项目侧栏、会话栏和上下文侧栏应支持合理的折叠或隐藏能力；会话栏折叠后聊天区应释放宽度，项目侧栏拖拽调整宽度时不得阻断侧栏内容的纵向滚动。
- Web 聊天输入应区分 Build 和 Plan 模式：Build 模式提交普通 Agent 消息，Plan 模式创建计划；Slash 命令不受当前模式影响。
- Web Plan 区应展示最新计划的摘要、步骤和状态，支持批准已就绪或审查中的计划，并在计划批准后触发执行。
- Web 客户端应支持 `/undo` 和 `/redo`，并在收到 `turn_undone`、`turn_redone`、`plan_updated` 事件后刷新消息、补丁、命令运行记录和计划状态。
- Web 客户端原有 manual、git、archive 项目来源和 managed workspace 模式必须保留；local 项目只作为新增项目类型显示。
- Web 客户端展示 local 项目时，应标注为 server local workspace，避免用户误解为浏览器本机路径。
- 代码查看应支持语法高亮，并按明暗主题切换 Shiki 高亮主题；代码编辑应支持常见语言扩展。
- 消息内容应支持 Markdown、表格、链接和 KaTeX 数学公式渲染，支持 `\(...\)`、`\[...\]`、`$$...$$` 和 `\begin{...}` 环境，并进行基础 HTML 净化。
- 工具消息应默认显示工具名、查询/命令/路径和状态摘要，详细 JSON 或长文本通过折叠详情查看。
- 前端应通过 Pinia 管理认证、工作区、审批和本地化状态。
- 前端应提供明暗主题切换入口，浅色主题下正文、侧边栏、聊天区、文件树、按钮、输入框和代码块应保持清晰可读。
- 审批区和命令运行区应支持面板级纵向滚动，避免长计划、长审批列表或命令输出遮挡后续内容。

### 6.10 TUI 客户端

- TUI 客户端位于 `tui/` 包，采用 Bun runtime、TypeScript、OpenTUI、Solid，CLI bin 命令为 `mebius`。
- TUI 客户端应通过 npm 包 `mebius-code` 分发，安装后暴露全局命令 `mebius`；npm postinstall 应从 GitHub Releases 下载当前平台原生二进制并校验 SHA256，避免普通用户手动安装 Bun。
- TUI 客户端应同时提供 Unix `curl | bash` 和 Windows PowerShell 安装方式，覆盖 Linux x64、macOS x64/arm64 和 Windows x64。
- `mebius` 默认以当前目录作为目标工作区，`mebius /path/to/project` 支持显式指定目录。
- MVP 阶段 TUI 不自动启动 NestJS 后端，而是连接已运行的 API；API 不可达时，TUI 和 `mebius doctor` 应给出清晰错误提示。
- TUI 启动时应调用 `GET /api/system/capabilities`，判断后端版本、serverMode、local workspace 能力、workspace modes 和功能开关。
- 当 API 地址为 localhost、127.0.0.1 或 ::1，且后端声明 local workspace 可用时，TUI 可以请求创建或获取当前目录对应的 local 项目。
- 当 `mebius --api <url>` 指向非本机地址时，TUI 默认进入 remote API mode，只能打开远程后端已有项目，不得提交本机路径。
- TUI 发布版默认 API 地址应指向公网演示服务 `http://182.92.150.169/api`，但用户仍可通过 `--api`、`login --api` 或 `config set api` 切换到私有后端。
- `mebius --api <url>` 只作为本次启动临时覆盖；持久保存 API 地址通过 `mebius login --api <url>` 或 `mebius config set api <url>` 完成。
- TUI 应支持 `login`、`logout`、`doctor` 和 API 配置命令，本地保存 apiBaseUrl、JWT、最近项目、最近会话和用户偏好。
- TUI 主界面采用左侧项目/文件/Git、中间聊天/输入、右侧状态/审批/预览的多面板工作台，并按终端宽度自适应。
- TUI 输入区应支持 Build 和 Plan 两种 composer 模式，`Tab` 可切换模式；Slash 命令始终按命令处理。
- TUI 应支持 `/sessions` 历史会话选择器，能够刷新当前项目会话列表、按标题和模型等信息搜索、按日期分组展示，并在选择会话后重新加载消息、计划、命令运行记录、审批状态、模型状态和 SSE 事件流。
- TUI 应支持 `/skills` 技能浏览命令，打开技能选择界面，展示已发现技能列表和详情，支持技能激活与关闭，并将活动技能上下文随消息或计划提交传递给后端。
- TUI 应支持 `/mcp` MCP 浏览命令，展示已配置服务器、启用状态、诊断状态、工具数量和工具详情，并支持刷新、启用、禁用和查看工具。
- TUI 应支持 `/mcp context7` 快速添加 Context7 预设，支持 `/mcp add <slug> <url>`、`/mcp tools <slug>`、`/mcp enable <slug>`、`/mcp disable <slug>` 和 `/mcp remove <slug>` 管理远程 MCP Server。
- TUI 应支持 `/init` 生成项目根目录 `AGENTS.md`，并支持 `/init --preview` 和 `/init --replace`。
- TUI 应支持 `/permissions` 查询和切换当前会话权限模式，支持 `/undo`、`/redo` 对最近回合执行撤销和重做，并支持 `/stream-test` 在无模型 Provider 时测试流式渲染。
- TUI 输入框应支持 Slash 命令自动补全，在用户输入 `/` 时展示可用命令和技能列表建议，选择建议后执行对应命令或插入技能前缀。
- TUI 消息渲染应支持 Markdown 基础样式，并将常见 LaTeX 数学块和行内公式转换为终端可读文本；代码块中的公式分隔符不得被转换。
- TUI 的 tool role 消息应默认压缩为摘要，长内容截断，支持 `/tools expand` 和 `/tools collapse` 切换详情展开状态。
- TUI 应展示 Agent 活动指示器，在 Agent 思考、响应、编辑文件、运行工具和等待模型时以动画形式显示当前阶段，空闲时隐藏指示器。
- TUI 空会话应展示品牌欢迎界面，包含 Mebius Code 标识、输入框、命令提示和键盘快捷键说明。
- TUI 应支持完整 Plan Mode 工作流，包括 `/plan` 生成草案、澄清问题作答、答案保存、计划定稿、审查批准、取消和已批准计划执行；Plan 审查和问答界面应在聊天区域内联展示。
- TUI Plan 就绪界面应提供开始实施、修改计划、继续讨论和取消等选择；修改计划调用后端修订接口，继续讨论调用后端计划讨论接口。
- TUI 工具审批应在聊天区域内联展示，提供 Allow once、Allow always 和 Reject 按钮，并支持键盘快捷键操作。
- TUI 右侧默认面板应展示 Status / Session 摘要，包括当前会话、任务状态、模型、上下文估算、workspace path、API mode、后端可达状态和 local workspace 开关；不应默认展示连续 token 调试日志。
- TUI 右侧日志区只展示最近少量高层事件，例如 `agent_status`、`message_created`、`model_call_started`、`model_call_completed`、`model_call_failed`、`error` 和 `done`，不得把每个 `token` 事件作为默认用户界面内容。
- 当前阶段 TUI 不实现 LSP，不展示 LSP 状态，不新增语言服务器、自动补全或跳转定义能力。
- TUI 首版文件树只做浏览和打开文件，不实现完整 IDE 编辑器。
- TUI 中的真实文件修改、补丁应用和命令执行必须沿用后端审批流程，先展示 Diff 或命令风险，再由用户确认。

### 6.11 Android 伴随客户端

- Android 客户端位于 `android/`，采用 Kotlin、Jetpack Compose、Material 3、Retrofit、OkHttp SSE、kotlinx.serialization 和 EncryptedSharedPreferences。
- Android 客户端应连接已有 Mebius API，不负责启动后端，不注册本机 local workspace，不实现手机端 IDE、文件编辑、Git 发布、MCP/Skills 管理或模型 Provider 设置。
- 用户可以在 Android 客户端登录，安全保存 API 地址、JWT 和用户名称；debug 构建默认模拟器 API 地址为 `http://10.0.2.2:3000/api`，release 构建默认公网 API 地址为 `http://182.92.150.169/api`，用户仍可在登录页或设置页修改。
- Android 客户端在课程演示阶段可不依赖应用市场上架，先通过 GitHub Releases 发布签名 APK，供用户下载后侧载安装；后续如进入正式公开分发，再补充应用市场上架流程。
- Android 客户端应提供设置页，允许用户查看当前连接、修改 API base URL、保存前用当前 session 验证新地址，并支持确认后登出清理本地会话。
- Android 客户端应提供移动概览页，展示当前用户、系统能力、项目列表、最近会话、Agent 活动、最新计划状态和待审批数量。
- Android 客户端应能打开项目会话列表，创建新会话、重命名会话、删除会话，并打开会话详情继续查看消息。
- Android 会话页应支持 Build / Plan 两种输入模式，Build 调用 Agent 运行接口，Plan 调用计划创建接口；会话 SSE 应展示状态、流式文本，并在消息、计划、工具结果或会话删除事件后刷新详情。
- Android 消息流应支持 Markdown 基础排版和数学公式块；数学公式通过随包本地 KaTeX 资源渲染，不依赖外网资源。
- Android 客户端应展示计划卡片、计划步骤、首个澄清问题选项、批准并执行计划、取消计划、工具审批卡片、补丁摘要、命令运行摘要和结构化 tool message 摘要。
- Android 工具审批当前只提供 `Allow once` 和 `Reject`，不提供项目级授权、会话级自动执行授权或完整 Diff 编辑体验。

## 7. 非功能性需求

- 安全性：密码哈希保存，注册邮箱验证码哈希保存，API Key 和 MCP Header 加密保存，JWT 鉴权，路径沙箱隔离，敏感目录屏蔽，高风险工具审批；local workspace 默认关闭，production 模式强制拒绝，所有真实目录操作都必须经过 sandbox 和审批边界；Web 检索和 MCP 返回内容必须作为不可信外部内容处理。
- 可用性：前端应对加载、运行、审批等待、错误和完成状态提供明确反馈，并通过下拉选择、禁用状态和滚动容器减少用户误操作；浅色主题普通文字不应使用低透明度样式，正文、次级文字、弱文字、背景、卡片和边框应采用稳定的高对比度配色。
- 可靠性：模型调用失败、流式输出失败、命令失败和补丁冲突都应以可理解错误返回。
- 可维护性：后端按模块划分，前端按视图、组件、状态管理和 API 类型组织。
- 可测试性：关键服务应有单元测试覆盖，包括注册验证码、用户偏好归一化、移动端概览聚合、模型流式解析、Plan Mode 生命周期与幂等创建、计划讨论与修订、旧计划状态归一化、Agent 工具循环与待审批阻塞、未知工具名校验、审批后恢复和工具消息还原、回合撤销/重做、活动技能注入、项目指令注入、Web 检索、MCP 工具暴露、模型诊断事件发布、命令策略、会话命令授权、命令运行环境提示、路径沙箱、local workspace 创建/删除保护、项目 Git 操作和审计查询；TUI 应覆盖启动、登录提示、API 不可达、SSE 解析、历史会话切换、Plan 问答/审查/讨论/修订、审批动作、文件树忽略规则、技能发现与选择、MCP 浏览、Slash 命令解析、Markdown 数学公式转换和工具消息摘要；Android 应通过 Kotlin 类型、Compose 构建和移动端手动验收覆盖登录、设置页、概览、会话、SSE、Plan、审批、Markdown 和本地 KaTeX 数学公式渲染主路径。
- 可部署性：本地环境应可通过 Docker Compose 启动 PostgreSQL 和后端 API；服务器演示环境应支持公网 IP 访问、Nginx 静态前端托管和 `/api` 反向代理，并允许后端以 systemd 服务连接本机 PostgreSQL 容器运行。
- 可分发性：仓库应通过 tag 触发 GitHub Actions 自动生成 TUI 原生二进制、TUI 安装脚本、Android release APK、SHA256 校验文件、GitHub Release 和 npm 包，保证 Web、TUI、Android 三端都能从公网入口或发布产物访问。
- 运维可验证性：服务器部署完成后应能通过 `GET /api/health` 验证后端健康状态，通过浏览器访问 Web 首页，并通过管理员账号登录验证认证链路、数据库连接和前后端代理配置。
- 性能约束：文件树单层读取数量、文本文件大小、命令输出长度、命令运行时长、归档上传大小和解压大小均应设限；真实本地仓库文件树不得递归扫描 `.git`、`node_modules`、数据集和模型产物等大型目录。

## 8. 客户端与服务端职责

服务端负责认证鉴权、邮箱验证码、系统能力声明、移动端概览聚合、数据持久化、项目工作区模型、仓库级 `AGENTS.md` 指令读取与生成、Plan Mode 生命周期、计划讨论与修订、模型调用、Agent 编排（含活动技能注入、项目指令注入、Web 检索、MCP 工具暴露和未知工具名校验）、工具执行、审批、回合撤销/重做、命令策略、会话命令授权、命令运行环境提示、文件沙箱、Git 操作和审计日志。

Web 客户端负责登录注册、managed 项目创建导入、项目和会话选择、模型配置、消息交互、Markdown/数学公式渲染、Build/Plan 输入模式、Plan 展示、批准与执行、回合撤销/重做、回合完成后 transcript 重载、工具审批、Diff 展示、代码编辑、命令授权状态、命令运行记录、Git 状态展示和审计查询。

TUI 客户端负责终端登录配置、本机或远程 API 连接、local 项目绑定、会话启动、SSE 流式消息展示、Markdown/数学公式终端渲染、Build/Plan composer、Plan 问答、审查、讨论与修订、审批交互、Diff 预览、命令预览、文件树浏览、技能发现与选择、MCP 浏览与管理、`/init` 项目指令生成、回合撤销/重做、工具消息摘要、Slash 命令自动补全、Agent 活动指示器和空会话欢迎界面。

Android 客户端负责移动端登录、API 地址与 JWT 本地加密保存、设置页连接管理与登出、项目和最近会话概览、会话打开与基础管理、Build/Plan 消息提交、SSE 状态跟随、Markdown/本地 KaTeX 数学公式渲染、计划卡片展示、一次性工具审批与拒绝，以及补丁和命令结果的轻量摘要展示。

## 9. UML 图

UML 源文件维护在 `docs/diagrams/` 下，最终 DOCX 中可渲染为图片：

- `use-case.puml`：系统用例图。
- `package.puml`：后端模块包图。
- `domain-class.puml`：核心领域类图。
- `deployment.puml`：部署图。

# Mebius Code 系统设计文档

## 1. 技术选型

- 后端框架：NestJS + TypeScript。
- 数据库：PostgreSQL。
- ORM：TypeORM。
- 认证：JWT + Passport。
- 实时事件：Server-Sent Events。
- 模型接入：OpenAI-compatible Chat Completions API。
- 部署：Docker Compose。

NestJS 使用类、装饰器、依赖注入、模块和服务组织业务逻辑，适合表达面向对象设计中的类职责、包职责和对象协作关系。

## 2. 系统架构

第一版采用模块化单体架构，内部按照未来微服务边界划分模块：

- `auth`：注册、登录、JWT 校验。
- `users`：用户资料和角色。
- `model-configs`：模型 Provider 配置和密钥加密。
- `projects`：服务端代码工作区和文件访问。
- `sessions`：会话、消息、上下文摘要和 Slash 命令。
- `agent`：Plan Mode、模型调用和工具循环。
- `tools`：函数工具、审批、补丁和命令执行。
- `events`：SSE 事件总线。
- `audit`：关键操作日志。

## 3. 数据设计

核心实体包括 `User`、`ModelConfig`、`Project`、`Session`、`Message`、`ConversationSummary`、`Plan`、`PlanStep`、`ToolCall`、`ToolApproval`、`FilePatch`、`CommandRun` 和 `AuditLog`。

## 4. 关键技术点

### 4.1 API Key 加密

用户提交的模型 API Key 不以明文保存，后端使用 `MEBIUS_CODE_MASTER_KEY` 派生 AES-256-GCM 密钥，将密文、IV 和认证标签一起保存到数据库。

### 4.2 路径沙箱

所有文件工具都以项目工作区为根目录解析相对路径。解析后的绝对路径必须位于项目根目录内，并默认阻止访问 `.git`、`.env`、`node_modules`、`dist` 等敏感或生成目录。

项目导入支持远端 Git 仓库克隆和本地 `.zip` 压缩包上传。压缩包导入会在服务端解析归档路径，拒绝目录穿越和绝对路径，跳过敏感或生成目录，并只写入当前项目沙箱中的空工作区。

### 4.3 工具审批

读文件、列目录和搜索属于只读工具，可以直接执行。补丁写入和命令执行属于高风险工具，必须创建审批记录，用户批准后才执行。

### 4.4 Plan Mode

Plan Mode 只生成计划和步骤，不执行文件写入或命令。计划被用户批准后，Agent 才能进入执行阶段。

## 5. 部署方案

本地和云服务器都使用 Docker Compose 启动 PostgreSQL。后端服务通过环境变量配置数据库连接、JWT 密钥、API Key 加密主密钥和工作区根目录。

Docker 镜像运行时包含 Node.js、Git 和 OpenSSH 客户端，用于服务端工作区 Git 导入和受控命令执行。健康检查接口为 `GET /api/health`。

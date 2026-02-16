# CLAUDE.md

本文件为 Claude Code 提供项目开发指南。

## 工作原则

1. **基于事实和逻辑**：所有决策和实现必须基于已验证的事实，不得基于猜测或假设
2. **遇到不确定时提问**：对需求、技术细节有疑问时，必须向用户确认，不得自行假设
3. **禁止未经验证的工作**：不在未证实的信息基础上开展工作
4. **方案必须经过 review**：任何实现方案都必须先向用户汇报并获得确认后才能开始编码。这是死命令，无例外
5. **文档先行**：所有工作开始前先更新相关文档，工作完成后更新 PLAN.md
6. **查阅官方文档优先**：编写任何配置文件或集成第三方服务前，必须先查阅官方文档确认正确格式，不得凭记忆猜测
7. **证明正确性**：任何配置文件改动，必须先向用户展示官方文档来源，证明配置是正确的，然后再执行改动。禁止先改动后查文档
8. **使用项目本地命令**：优先使用项目 `package.json` 中定义的脚本，而不是 `npx` 直接调用工具

### 反面案例

- **凭记忆写 claude -p 参数**：未查阅 `claude --help` 就假设某个 flag 存在，导致调用失败。正确做法是先运行 `claude --help` 或查阅官方文档确认参数
- **假设 Agent SDK 可用 Max 订阅**：未验证就在方案中使用 Agent SDK + Max 认证。经研究确认 Agent SDK 走 API Key 计费，与 Max 订阅是不同认证体系。正确做法是先验证技术可行性再纳入方案
- **未测试就声称可行**：声称 `--resume` 和 `--output-format json` 可以组合使用但未实测。正确做法是先写测试命令验证，用事实说话

## 技术决策规范

当存在多个可行方案时，必须进行多维度对比分析后再做决策。

### 对比维度

| 维度 | 说明 |
|------|------|
| **代码复杂度** | 改动量、理解难度 |
| **可维护性** | 逻辑是否集中、是否易于修改 |
| **性能影响** | 运行时开销、渲染次数 |
| **扩展性** | 是否易于支持未来需求 |
| **架构一致性** | 是否符合现有设计模式 |
| **实现成本** | 开发时间、测试复杂度 |

### 决策优先级

1. **正确性优先**：代码逻辑必须完备，覆盖所有边界情况
2. **架构一致性**：优先保持现有抽象，避免引入特殊分支
3. **可扩展性**：考虑方案是否能复用于类似场景
4. **最小改动**（辅助因素）：在满足上述条件的前提下，优先选择改动较小的方案

### 输出格式

```markdown
## 方案对比

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| ... | ... | ... |

## 推荐方案

**推荐方案 X**

**原因**：
1. ...
2. ...
```

## 项目概述

Conductor 是 Claude Code 的编排管理层。通过封装 `claude -p`（headless 模式）为常驻服务，暴露统一的 REST + SSE API，将核心管理能力与展示层解耦。

## 架构

```
展示层 (Telegram / Discord / Web UI / CLI)
  │  REST + SSE
  ▼
Conductor Core
  │  claude -p --output-format stream-json
  ▼
Claude Code CLI (Max subscription)
```

## 已确认决策

| 决策点 | 结论 |
|------|------|
| 状态持久化 | 文件持久化 |
| API 协议 | REST + SSE 流式 |
| 常驻机制 | MVP 阶段裸进程 |
| 并发模型 | 并行，上限为必填配置项 |
| 会话模型 | 调用方管 session，核心层不做路由 |
| CWD 策略 | 每个 session 独立目录，支持 git clone + checkout |
| Session 创建 | 创建即首次对话，用 Claude 的 session_id 作为唯一标识 |
| 技术栈 | TypeScript / Node.js |
| 配置格式 | YAML |
| Env 概念 | 配置文件预定义，包含 allowedTools / max_turns / 环境变量，请求时必填 |

## API 端点

| 端点 | 参数 | 用途 |
|------|------|------|
| `POST /sessions` | `prompt`, `env` (必填), `repo`, `branch` (可选) | 创建 session + 发首条消息，SSE 流式返回 |
| `POST /sessions/:id/messages` | `prompt` (必填) | 后续消息，SSE 流式返回 |
| `POST /sessions/:id/cancel` | — | 取消执行中的任务 |
| `GET /sessions` | — | 会话列表 |
| `GET /sessions/:id` | — | 会话详情 |
| `GET /health` | — | 服务状态 |

## 配置文件 (conductor.yaml)

```yaml
concurrency: 3                                    # 必填，并发上限
workspace_root: "/Users/dennis/.conductor/workspaces"  # 必填，session 工作目录根路径

envs:                                              # 至少定义一个
  full:
    allowedTools: "Bash,Read,Edit,Write,Glob,Grep,WebSearch,WebFetch,Task"
    max_turns: 20
    env: {}
  readonly:
    allowedTools: "Read,Glob,Grep,WebSearch"
    max_turns: 5
    env: {}
```

## 架构约束

- 所有 Claude Code 交互必须通过 `claude -p` + `--output-format json` 或 `stream-json`
- 禁止解析交互式终端输出，只使用 headless 模式
- 会话连续性通过 `--resume <session-id>` 实现，必须持久化 session ID
- 工具审批通过 `--allowedTools` 控制，生产环境禁止使用 `--dangerously-skip-permissions`
- 生成 `claude -p` 子进程时必须清除 `CLAUDECODE` 环境变量以绕过嵌套检测
- **Session 与 CWD 强绑定**：`--resume` 只能在创建 session 时的同一 CWD 下生效（已验证，见 FACTS.md）。恢复 session 时必须使用创建时相同的 CWD
- `claude` CLI 没有 `--cwd` 参数，CWD 只能通过 `spawn` 的 `cwd` 选项控制
- **CLAUDE.md 只从 CWD 加载**，不向上查找父目录。软链接 CLAUDE.md 可被识别（已验证，见 FACTS.md）

## Session 生命周期

```
POST /sessions { prompt, env, repo?, branch? }
  │
  ├─ 有 repo: git clone --branch <branch> <repo> <workspace_root>/<session-id>/
  ├─ 无 repo: mkdir <workspace_root>/<session-id>/
  │
  ├─ 以 <workspace_root>/<session-id>/ 为 CWD
  ├─ spawn: claude -p <prompt> --output-format stream-json --allowedTools <env.allowedTools> --max-turns <env.max_turns>
  │
  ├─ 从响应中提取 claude session_id，持久化映射：session_id → { cwd, env, claude_session_id }
  └─ SSE 流式返回响应

POST /sessions/:id/messages { prompt }
  │
  ├─ 查找持久化的映射，获取 cwd 和 claude_session_id
  ├─ spawn: claude -p <prompt> --resume <claude_session_id> --output-format stream-json ...
  └─ SSE 流式返回响应
```

## Claude -p 调用规范

```bash
# 创建新会话
claude -p "<prompt>" --output-format stream-json --allowedTools "Bash,Read,..." --max-turns 20

# 恢复已有会话
claude -p "<prompt>" --resume <session-id> --output-format stream-json --allowedTools "..."
```

### 响应结构

JSON 模式返回单个对象：
```json
{
  "type": "result",
  "subtype": "success",
  "result": "Claude 的文本回复",
  "session_id": "uuid",
  "num_turns": 3,
  "total_cost_usd": 0.01,
  "usage": { ... }
}
```

Stream-JSON 模式逐行输出三种消息：
- `{"type": "system", "subtype": "init", ...}` — 会话元数据
- `{"type": "assistant", "message": {...}, ...}` — Claude 的回复
- `{"type": "result", ...}` — 最终汇总

### 子进程 spawn 规范

```typescript
spawn('claude', args, {
  cwd: sessionWorkspacePath,
  env: { ...process.env, CLAUDECODE: '', ...envConfig.env }
})
```

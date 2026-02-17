# CLAUDE.md

本文件为 Claude Code 提供项目开发指南。

## 工作原则

1. **基于事实和逻辑**：所有决策和实现必须基于已验证的事实，不得基于猜测或假设
2. **遇到不确定时提问**：对需求、技术细节有疑问时，必须向用户确认，不得自行假设
3. **禁止未经验证的工作**：不在未证实的信息基础上开展工作
4. **方案必须经过 review**：任何实现方案都必须先向用户汇报并获得确认后才能开始编码。这是死命令，无例外
5. **文档先行**：所有工作开始前先更新相关文档，工作完成后更新 PLAN.md
6. **查阅官方文档优先**：编写任何配置文件、集成第三方服务、或引用框架/库的推荐模式前，必须先查阅官方文档确认，不得凭记忆猜测
7. **证明正确性**：任何引用官方文档或权威来源来支撑方案的场景，必须先查证并向用户展示来源，证明引用是准确的，然后再基于此推进。禁止先引用后查证
8. **禁止使用 `npx`**：任何场景都禁止使用 `npx`，必须使用项目 `package.json` 中定义的脚本（如 `pnpm test`、`pnpm typecheck`）
9. **Always TDD**：所有代码变更必须先写失败测试，再写实现使测试通过。禁止先写实现后补测试
10. **Bug 修复必须先定位**：收到 Bug 报告后，必须先查看实际数据（日志、消息文件、网络请求）定位根因，禁止基于猜测直接修改代码。定位结果需向用户汇报确认后再制定修复方案
11. **禁止 `as` 类型断言**：TypeScript 代码中禁止使用 `as` 进行类型断言。必须通过严格的类型定义、类型守卫（type guard）、Zod 等方式确保类型安全。类型不匹配必须报编译错误，不得用 `as` 绕过
12. **禁止死代码和投机性代码**：未使用的变量、函数、import 必须直接删除，不得保留。禁止用 `_` 前缀重命名、`// reserved for future use`、`// TODO: might need later` 等方式保留死代码。代码库中只允许存在当前实际使用的代码
13. **禁止过度抽象**：不为简单操作创建独立的接口、类型守卫函数或工具函数。如果一个检查只在一处使用且逻辑简单，直接内联。代码的复杂度必须与问题的复杂度匹配
14. **注释必须准确描述因果关系**：代码注释中描述"为什么"时，必须准确描述真实的技术因果链。不理解机制就不要写注释，错误的注释比没有注释更糟糕

### 反面案例

- **凭记忆写 claude -p 参数**：未查阅 `claude --help` 就假设某个 flag 存在，导致调用失败。正确做法是先运行 `claude --help` 或查阅官方文档确认参数
- **假设 Agent SDK 可用 Max 订阅**：未验证就在方案中使用 Agent SDK + Max 认证。经研究确认 Agent SDK 走 API Key 计费，与 Max 订阅是不同认证体系。正确做法是先验证技术可行性再纳入方案
- **未测试就声称可行**：声称 `--resume` 和 `--output-format json` 可以组合使用但未实测。正确做法是先写测试命令验证，用事实说话
- **未定位就修复 Bug**：用户报告"tool call 显示两次"，未查看实际消息数据就假设是"并行工具调用导致的事件乱序"，直接开始重写渲染逻辑。正确做法是先查看 session 的消息 JSON，确认事件序列和数据内容，定位真正的重复来源，再制定修复方案
- **保留死代码"备用"**：删除 `creating` 状态后改为 `const [_creating] = useState(false) // reserved for future use`。这是垃圾代码，未使用的东西直接删除，不存在"备用"一说
- **过度抽象简单逻辑**：为 `location.state` 类型检查创建独立的 `CreateState` 接口和 `isCreateState` 类型守卫函数，而实际只在一处使用且逻辑极简。正确做法是内联检查
- **注释因果关系错误**：写 `// Update URL without triggering React Router re-render (which would abort the stream)`，把 re-render 和 stream 中断关联起来。实际机制是 `navigate` → `useParams` 的 `id` 变化 → `useEffect` cleanup → `controller.abort()`。这是 effect 生命周期问题，不是 re-render 问题。不理解机制就不要写注释
- **凭记忆引用官方文档**：提出 useRef 防止 StrictMode double-mount 的方案时，声称"这是 React 官方文档推荐的模式"，但未查阅文档。实际查阅后发现 React 文档明确反对此模式（"Don't use refs to prevent Effects from firing"）。正确做法是先查阅官方文档，确认引用准确后再呈现给用户

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
| `POST /sessions` | `prompt`, `env` (必填), `repo`, `branch` (可选) | 创建 session + 发首条消息，返回 JSON `{ session_id, workspace }` |
| `POST /sessions/:id/messages` | `prompt` (必填) | 后续消息，返回 JSON `{ session_id, status }` |
| `GET /sessions/:id/events` | — | SSE 流式订阅（含缓冲 replay），客户端断开不影响 claude 进程 |
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

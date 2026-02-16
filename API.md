# API Reference

Conductor API 文档。所有端点监听 `localhost`，无认证（MVP）。

## 通用约定

### 请求格式

- Content-Type: `application/json`
- 字符编码: UTF-8

### 错误响应

所有端点使用统一的错误格式：

```json
{
  "error": {
    "code": "INVALID_ENV",
    "message": "env 'xyz' not found in configuration"
  }
}
```

错误码列表：

| HTTP Status | Code | 说明 |
|-------------|------|------|
| 400 | `MISSING_FIELD` | 缺少必填参数 |
| 400 | `INVALID_ENV` | 请求的 env 不在配置文件中 |
| 404 | `SESSION_NOT_FOUND` | session ID 不存在 |
| 409 | `SESSION_BUSY` | 该 session 正在执行中，无法接受新消息 |
| 503 | `CONCURRENCY_LIMIT` | 已达并发上限，请稍后重试 |
| 500 | `CLONE_FAILED` | git clone 失败 |
| 500 | `CLAUDE_ERROR` | claude -p 进程异常退出 |

---

## POST /sessions

创建新 session 并发送首条消息。返回 SSE 流式响应。

### Request

```json
{
  "prompt": "帮我看一下 src/index.ts 的代码",
  "env": "full",
  "repo": "/Users/dennis/Repositories/.../project-iris",
  "branch": "main"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 首条消息内容 |
| `env` | string | 是 | 配置文件中定义的 env 名称 |
| `repo` | string | 否 | 本地 git 仓库路径，传入则 clone 到 session 工作目录 |
| `branch` | string | 否 | checkout 的分支，配合 repo 使用，不传则用仓库默认分支 |

### Response

HTTP 200，Content-Type: `text/event-stream`

SSE 事件序列：

#### 1. `session_created`

session 创建成功，返回 session ID 和元数据。这是第一个事件。

```
event: session_created
data: {"session_id": "2dc11ed7-ac86-49a1-a382-f48533cf45b4", "workspace": "/Users/dennis/.conductor/workspaces/2dc11ed7-..."}
```

#### 2. `text_delta`

Claude 的文本回复片段，逐 token 推送。

```
event: text_delta
data: {"text": "我来"}
```

```
event: text_delta
data: {"text": "看一下"}
```

#### 3. `tool_use`

Claude 正在调用工具。展示层可用于显示活动状态。

```
event: tool_use
data: {"tool": "Read", "input": {"file_path": "/src/index.ts"}}
```

#### 4. `result`

执行完成。这是最后一个事件。

```
event: result
data: {"result": "完整的回复文本", "num_turns": 3, "cost_usd": 0.01}
```

#### 5. `error`

执行过程中出错。

```
event: error
data: {"code": "CLAUDE_ERROR", "message": "claude process exited with code 1"}
```

### 错误

| 场景 | HTTP Status | Code |
|------|-------------|------|
| 缺少 prompt 或 env | 400 | `MISSING_FIELD` |
| env 不存在 | 400 | `INVALID_ENV` |
| 并发已满 | 503 | `CONCURRENCY_LIMIT` |
| clone 失败 | 500 | `CLONE_FAILED` |

---

## POST /sessions/:id/messages

向已有 session 发送后续消息。返回 SSE 流式响应。

### Request

```json
{
  "prompt": "把那个函数重构一下"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 消息内容 |

### Response

HTTP 200，Content-Type: `text/event-stream`

SSE 事件序列与 `POST /sessions` 相同（`text_delta` → `tool_use` → `result`），但不包含 `session_created` 事件。

### 错误

| 场景 | HTTP Status | Code |
|------|-------------|------|
| session 不存在 | 404 | `SESSION_NOT_FOUND` |
| session 正在执行 | 409 | `SESSION_BUSY` |
| 并发已满 | 503 | `CONCURRENCY_LIMIT` |

---

## POST /sessions/:id/cancel

取消 session 中正在执行的 claude -p 进程。

### Request

无 body。

### Response

```json
{
  "session_id": "2dc11ed7-...",
  "status": "cancelled"
}
```

### 错误

| 场景 | HTTP Status | Code |
|------|-------------|------|
| session 不存在 | 404 | `SESSION_NOT_FOUND` |
| session 没有在执行 | 409 | `SESSION_IDLE` |

---

## GET /sessions

列出所有 Conductor 管理的 session。

### Request

无参数。

### Response

```json
{
  "sessions": [
    {
      "session_id": "2dc11ed7-...",
      "env": "full",
      "workspace": "/Users/dennis/.conductor/workspaces/2dc11ed7-...",
      "repo": "/Users/dennis/Repositories/.../project-iris",
      "branch": "main",
      "status": "idle",
      "created_at": "2026-02-16T00:45:34.006Z",
      "last_active_at": "2026-02-16T01:30:00.000Z",
      "message_count": 12
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_id` | string | Claude 的 session ID |
| `env` | string | 使用的 env 名称 |
| `workspace` | string | session 工作目录路径 |
| `repo` | string \| null | 来源仓库路径 |
| `branch` | string \| null | 来源分支 |
| `status` | string | `idle` / `running` / `cancelled` |
| `created_at` | string | ISO 8601 创建时间 |
| `last_active_at` | string | ISO 8601 最后活跃时间 |
| `message_count` | number | 消息条数 |

---

## GET /sessions/:id

获取单个 session 的详情和对话历史。

### Response

```json
{
  "session_id": "2dc11ed7-...",
  "env": "full",
  "workspace": "/Users/dennis/.conductor/workspaces/2dc11ed7-...",
  "repo": "/Users/dennis/Repositories/.../project-iris",
  "branch": "main",
  "status": "idle",
  "created_at": "2026-02-16T00:45:34.006Z",
  "last_active_at": "2026-02-16T01:30:00.000Z",
  "messages": [
    {
      "role": "user",
      "content": "帮我看一下 src/index.ts 的代码",
      "timestamp": "2026-02-16T00:45:34.006Z"
    },
    {
      "role": "assistant",
      "content": "这个文件是项目入口...",
      "timestamp": "2026-02-16T00:45:37.000Z"
    }
  ]
}
```

### 错误

| 场景 | HTTP Status | Code |
|------|-------------|------|
| session 不存在 | 404 | `SESSION_NOT_FOUND` |

---

## GET /health

服务健康状态。

### Response

```json
{
  "status": "ok",
  "running_tasks": 1,
  "concurrency_limit": 3,
  "active_sessions": 5
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `ok` |
| `running_tasks` | number | 当前正在执行的 claude -p 进程数 |
| `concurrency_limit` | number | 配置的并发上限 |
| `active_sessions` | number | Conductor 管理的 session 总数 |

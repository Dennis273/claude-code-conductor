# Claude Code CLI 输出格式分析

基于 Claude Code CLI v2.1.44 和 Agent SDK v0.2.44 的源码分析。

**数据来源**：
- `@anthropic-ai/claude-agent-sdk@0.2.44` 的 `sdk.d.ts`（权威类型定义，64KB）
- `claude --help` 输出
- 实际 CLI 调用的 stdout 输出验证
- 项目 `src/core/claude.ts` 的现有解析实现

---

## 1. 三种输出模式概览

| 模式 | `--output-format` 值 | 前置条件 | 输出格式 | 用途 |
|------|---------------------|----------|---------|------|
| **Text** | `text`（默认） | `--print` | 纯文本 | 管道/脚本，只取最终文本结果 |
| **JSON** | `json` | `--print` | 单个 JSON 对象 | 需要完整元数据的单次调用 |
| **Stream-JSON** | `stream-json` | `--print` + `--verbose` | NDJSON（每行一个 JSON） | 实时流式输出，我们的主要使用方式 |

### 1.1 约束关系

```
--output-format stream-json  →  必须搭配 --verbose，否则报错：
  "Error: When using --print, --output-format=stream-json requires --verbose"

--include-partial-messages  →  仅在 --print + --output-format=stream-json 下生效
  增加 stream_event 类型消息（Anthropic API 级别的逐 token 事件）

--json-schema  →  仅在 --print 下生效
  成功时 result 消息增加 structured_output 字段

--output-format json + --verbose  →  输出变为 JSON 数组（包含所有消息），而非单个 result 对象
```

---

## 2. Text 模式（`--output-format text`）

最简单的模式。只输出最终文本结果到 stdout，错误输出到 stderr。

```bash
$ claude -p "say hello" --max-turns 1
Hello
```

**错误情况**：不输出 JSON，只在 stderr 写错误文本，exit code 非 0。

**text 模式的内部逻辑**（从 cli.js 反编译）：

| result.subtype | stdout 输出 |
|---------------|-------------|
| `success` | `result.result`（纯文本） |
| `error_during_execution` | `"Execution error"` |
| `error_max_turns` | `"Error: Reached max turns (N)"` |
| `error_max_budget_usd` | `"Error: Exceeded USD budget (N)"` |
| `error_max_structured_output_retries` | `"Error: Failed to provide valid structured output..."` |

---

## 3. JSON 模式（`--output-format json`）

### 3.1 默认（无 `--verbose`）

输出**单个** `SDKResultMessage` 对象：

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 3102,
  "duration_api_ms": 2516,
  "num_turns": 1,
  "result": "Hello",
  "stop_reason": null,
  "session_id": "867b69cf-...",
  "total_cost_usd": 0.0130445,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 25859,
    "output_tokens": 4,
    "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
    "service_tier": "standard",
    "cache_creation": { "ephemeral_1h_input_tokens": 0, "ephemeral_5m_input_tokens": 0 },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "modelUsage": {
    "claude-opus-4-6": {
      "inputTokens": 3,
      "outputTokens": 4,
      "cacheReadInputTokens": 25859,
      "cacheCreationInputTokens": 0,
      "webSearchRequests": 0,
      "costUSD": 0.0130445,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  },
  "permission_denials": [],
  "uuid": "f44dd8b3-..."
}
```

### 3.2 带 `--verbose`

输出 **JSON 数组**，包含所有消息：

```json
[
  {"type": "system", "subtype": "init", ...},
  {"type": "assistant", "message": {...}, ...},
  {"type": "result", ...}
]
```

---

## 4. Stream-JSON 模式（`--output-format stream-json --verbose`）

NDJSON 格式，每行一个独立的 JSON 对象。这是我们项目使用的模式。

### 4.1 SDKMessage 联合类型（公开 API，共 16 种）

来自 `sdk.d.ts` 第 1476 行：

```typescript
type SDKMessage =
  | SDKAssistantMessage           // type: "assistant"
  | SDKUserMessage                // type: "user"
  | SDKUserMessageReplay          // type: "user" (isReplay: true)
  | SDKResultMessage              // type: "result"
  | SDKSystemMessage              // type: "system", subtype: "init"
  | SDKPartialAssistantMessage    // type: "stream_event" (仅 --include-partial-messages)
  | SDKCompactBoundaryMessage     // type: "system", subtype: "compact_boundary"
  | SDKStatusMessage              // type: "system", subtype: "status"
  | SDKHookStartedMessage         // type: "system", subtype: "hook_started"
  | SDKHookProgressMessage        // type: "system", subtype: "hook_progress"
  | SDKHookResponseMessage        // type: "system", subtype: "hook_response"
  | SDKToolProgressMessage        // type: "tool_progress"
  | SDKAuthStatusMessage          // type: "auth_status"
  | SDKTaskNotificationMessage    // type: "system", subtype: "task_notification"
  | SDKFilesPersistedEvent        // type: "system", subtype: "files_persisted"
  | SDKToolUseSummaryMessage      // type: "tool_use_summary"
```

### 4.2 内部协议消息（StdoutMessage，SDK 内部使用）

`StdoutMessage` 是 `SDKMessage` 的超集，额外包含：

```typescript
type StdoutMessage =
  | SDKMessage                              // 上述 16 种
  | SDKStreamlinedTextMessage               // 内部: type "streamlined_text"
  | SDKStreamlinedToolUseSummaryMessage     // 内部: type "streamlined_tool_use_summary"
  | SDKControlResponse                      // 内部: type "control_response"
  | SDKControlRequest                       // 内部: type "control_request"
  | SDKControlCancelRequest                 // 内部: type "control_cancel_request"
  | SDKKeepAliveMessage                     // 内部: type "keep_alive"
```

**注意**：`claude -p` 的 stdout 输出的是 `SDKMessage`，内部协议类型仅在 Agent SDK 的进程间通信中使用，CLI 模式不会输出。

---

## 5. 各消息类型详细定义

### 5.1 SDKSystemMessage — 会话初始化（首条消息）

```typescript
type SDKSystemMessage = {
  type: "system"
  subtype: "init"
  agents?: string[]                           // 可用的 agent 列表
  apiKeySource: "user" | "project" | "org" | "temporary"
  betas?: string[]
  claude_code_version: string                 // e.g. "2.1.44"
  cwd: string
  tools: string[]                             // 可用工具列表
  mcp_servers: { name: string; status: string }[]
  model: string                               // e.g. "claude-opus-4-6"
  permissionMode: PermissionMode
  slash_commands: string[]
  output_style: string
  skills: string[]
  plugins: { name: string; path: string }[]
  uuid: UUID
  session_id: string
}
```

**实际输出额外字段**（未在类型定义中，但实际存在）：
- `fast_mode_state: "off" | "on"` — Fast mode 状态

**实测输出示例**：
```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/Users/dennis",
  "session_id": "320e6aae-...",
  "tools": ["Task", "Bash", "Read", "Edit", ...],
  "mcp_servers": [{"name": "blender", "status": "connected"}],
  "model": "claude-opus-4-6",
  "permissionMode": "dontAsk",
  "apiKeySource": "none",
  "claude_code_version": "2.1.44",
  "output_style": "default",
  "agents": ["Bash", "general-purpose", "Explore", "Plan", ...],
  "skills": ["keybindings-help", "debug", ...],
  "plugins": [],
  "uuid": "96b1384f-...",
  "fast_mode_state": "off"
}
```

### 5.2 SDKAssistantMessage — Claude 的完整回复

```typescript
type SDKAssistantMessage = {
  type: "assistant"
  message: BetaMessage                        // Anthropic API 的完整消息对象
  parent_tool_use_id: string | null           // null=顶层, string=子代理上下文
  error?: SDKAssistantMessageError            // 可选错误标记
  uuid: UUID
  session_id: string
}

type SDKAssistantMessageError =
  | "authentication_failed"
  | "billing_error"
  | "rate_limit"
  | "invalid_request"
  | "server_error"
  | "unknown"
  | "max_output_tokens"
```

**`BetaMessage` 内嵌的 `content` 数组可包含**：
- `{ type: "text", text: "..." }` — 文本内容
- `{ type: "tool_use", id: "toolu_...", name: "Read", input: {...} }` — 工具调用
- `{ type: "thinking", thinking: "..." }` — 扩展思考（如果启用）

**实测输出示例**：
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_01QLz...",
    "type": "message",
    "role": "assistant",
    "content": [{"type": "text", "text": "Hello"}],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 4928,
      "cache_read_input_tokens": 20931,
      "output_tokens": 1,
      "service_tier": "standard"
    },
    "context_management": null
  },
  "parent_tool_use_id": null,
  "session_id": "320e6aae-...",
  "uuid": "1765d405-..."
}
```

### 5.3 SDKUserMessage — 用户消息 / 工具结果

```typescript
type SDKUserMessage = {
  type: "user"
  message: MessageParam                       // Anthropic API MessageParam
  parent_tool_use_id: string | null
  isSynthetic?: boolean                       // 系统生成的合成消息
  tool_use_result?: unknown
  uuid?: UUID
  session_id: string
}
```

**`message.content` 可包含**：
- `{ type: "text", text: "..." }` — 用户输入文本
- `{ type: "tool_result", tool_use_id: "toolu_...", content: "...", is_error: false }` — 工具执行结果

### 5.4 SDKUserMessageReplay — 恢复会话时的重放消息

```typescript
type SDKUserMessageReplay = {
  type: "user"
  message: MessageParam
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  uuid: UUID
  session_id: string
  isReplay: true                              // 区别于普通 user 消息
}
```

### 5.5 SDKResultMessage — 执行完成（最后一条消息）

```typescript
type SDKResultMessage = SDKResultSuccess | SDKResultError

type SDKResultSuccess = {
  type: "result"
  subtype: "success"
  duration_ms: number
  duration_api_ms: number
  is_error: boolean                           // false
  num_turns: number
  result: string                              // 最终文本结果
  stop_reason: string | null
  total_cost_usd: number
  usage: NonNullableUsage
  modelUsage: Record<string, ModelUsage>
  permission_denials: SDKPermissionDenial[]
  structured_output?: unknown                 // 仅 --json-schema 时存在
  uuid: UUID
  session_id: string
}

type SDKResultError = {
  type: "result"
  subtype: "error_during_execution"
         | "error_max_turns"
         | "error_max_budget_usd"
         | "error_max_structured_output_retries"
  duration_ms: number
  duration_api_ms: number
  is_error: boolean                           // true
  num_turns: number
  stop_reason: string | null
  total_cost_usd: number
  usage: NonNullableUsage
  modelUsage: Record<string, ModelUsage>
  permission_denials: SDKPermissionDenial[]
  errors: string[]                            // 错误消息列表
  uuid: UUID
  session_id: string
}
```

**实测输出示例**：
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 3271,
  "duration_api_ms": 2562,
  "num_turns": 1,
  "result": "Hello",
  "stop_reason": null,
  "session_id": "320e6aae-...",
  "total_cost_usd": 0.0413805,
  "usage": {
    "input_tokens": 3,
    "cache_creation_input_tokens": 4928,
    "cache_read_input_tokens": 20931,
    "output_tokens": 4,
    "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0},
    "service_tier": "standard"
  },
  "modelUsage": {
    "claude-opus-4-6": {
      "inputTokens": 3,
      "outputTokens": 4,
      "cacheReadInputTokens": 20931,
      "cacheCreationInputTokens": 4928,
      "webSearchRequests": 0,
      "costUSD": 0.0413805,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  },
  "permission_denials": [],
  "uuid": "11fb558d-..."
}
```

### 5.6 SDKPartialAssistantMessage — 流式事件（仅 `--include-partial-messages`）

```typescript
type SDKPartialAssistantMessage = {
  type: "stream_event"
  event: BetaRawMessageStreamEvent           // Anthropic API 流式事件
  parent_tool_use_id: string | null
  uuid: UUID
  session_id: string
}
```

**`event` 字段的可能值**（Anthropic API 流式事件类型）：

| event.type | 含义 | 关键字段 |
|-----------|------|---------|
| `message_start` | 消息开始 | `event.message` — 初始消息对象（content 为空） |
| `content_block_start` | 内容块开始 | `event.content_block` — `{type: "text"}` 或 `{type: "tool_use", id, name}` |
| `content_block_delta` | 内容块增量 | `event.delta` — `{type: "text_delta", text}` 或 `{type: "input_json_delta", partial_json}` |
| `content_block_stop` | 内容块结束 | `event.index` |
| `message_delta` | 消息级更新 | `event.delta.stop_reason`, `event.usage` |
| `message_stop` | 消息结束 | — |

**实测消息序列**（简单文本回复 "Hello"）：
```
stream_event: message_start       ← 消息开始
stream_event: content_block_start ← text 块开始
stream_event: content_block_delta ← text_delta: "Hello"
assistant: (完整消息)              ← 完整 assistant 消息（content 已拼接）
stream_event: content_block_stop  ← text 块结束
stream_event: message_delta       ← stop_reason, usage
stream_event: message_stop        ← 消息结束
result: (最终结果)
```

**关键观察**：`assistant` 消息插入在 `content_block_delta` 和 `content_block_stop` 之间，包含已拼接完成的完整 content。

### 5.7 SDKStatusMessage — 状态变更

```typescript
type SDKStatusMessage = {
  type: "system"
  subtype: "status"
  status: "compacting" | null                 // compacting=正在压缩上下文, null=恢复正常
  permissionMode?: PermissionMode
  uuid: UUID
  session_id: string
}
```

### 5.8 SDKCompactBoundaryMessage — 上下文压缩边界

```typescript
type SDKCompactBoundaryMessage = {
  type: "system"
  subtype: "compact_boundary"
  compact_metadata: {
    trigger: "manual" | "auto"                // 手动(/compact) 或自动(接近上下文上限)
    pre_tokens: number                        // 压缩前的 token 数
  }
  uuid: UUID
  session_id: string
}
```

### 5.9 SDKToolProgressMessage — 工具执行进度

```typescript
type SDKToolProgressMessage = {
  type: "tool_progress"
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string | null
  elapsed_time_seconds: number
  uuid: UUID
  session_id: string
}
```

### 5.10 SDKToolUseSummaryMessage — 工具使用摘要

```typescript
type SDKToolUseSummaryMessage = {
  type: "tool_use_summary"
  summary: string
  preceding_tool_use_ids: string[]
  uuid: UUID
  session_id: string
}
```

### 5.11 SDKAuthStatusMessage — 认证状态

```typescript
type SDKAuthStatusMessage = {
  type: "auth_status"
  isAuthenticating: boolean
  output: string[]
  error?: string
  uuid: UUID
  session_id: string
}
```

### 5.12 SDKTaskNotificationMessage — 子任务通知

```typescript
type SDKTaskNotificationMessage = {
  type: "system"
  subtype: "task_notification"
  task_id: string
  status: "completed" | "failed" | "stopped"
  output_file: string
  summary: string
  uuid: UUID
  session_id: string
}
```

### 5.13 SDKFilesPersistedEvent — 文件持久化事件

```typescript
type SDKFilesPersistedEvent = {
  type: "system"
  subtype: "files_persisted"
  files: { filename: string; file_id: string }[]
  failed: { filename: string; error: string }[]
  processed_at: string
  uuid: UUID
  session_id: string
}
```

### 5.14 Hook 相关消息（三种）

```typescript
type SDKHookStartedMessage = {
  type: "system"
  subtype: "hook_started"
  hook_id: string
  hook_name: string
  hook_event: string
  uuid: UUID
  session_id: string
}

type SDKHookProgressMessage = {
  type: "system"
  subtype: "hook_progress"
  hook_id: string
  hook_name: string
  hook_event: string
  stdout: string
  stderr: string
  output: string
  uuid: UUID
  session_id: string
}

type SDKHookResponseMessage = {
  type: "system"
  subtype: "hook_response"
  hook_id: string
  hook_name: string
  hook_event: string
  output: string
  stdout: string
  stderr: string
  exit_code?: number
  outcome: "success" | "error" | "cancelled"
  uuid: UUID
  session_id: string
}
```

---

## 6. 支撑类型

```typescript
type NonNullableUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

type SDKPermissionDenial = {
  tool_name: string
  tool_use_id: string
  tool_input: Record<string, unknown>
}

type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "delegate" | "dontAsk"
```

---

## 7. 消息类型速查表

### 按 `type` 字段分类

| type 值 | 子类型/区分方式 | 消息名 | 出现时机 |
|---------|---------------|--------|---------|
| `system` | `subtype: "init"` | SDKSystemMessage | 首条消息 |
| `system` | `subtype: "status"` | SDKStatusMessage | 状态变更（如 compacting） |
| `system` | `subtype: "compact_boundary"` | SDKCompactBoundaryMessage | 上下文压缩后 |
| `system` | `subtype: "hook_started"` | SDKHookStartedMessage | Hook 开始执行 |
| `system` | `subtype: "hook_progress"` | SDKHookProgressMessage | Hook 执行中 |
| `system` | `subtype: "hook_response"` | SDKHookResponseMessage | Hook 执行完成 |
| `system` | `subtype: "task_notification"` | SDKTaskNotificationMessage | 子任务完成/失败/停止 |
| `system` | `subtype: "files_persisted"` | SDKFilesPersistedEvent | 文件持久化完成 |
| `assistant` | — | SDKAssistantMessage | Claude 完整回复 |
| `user` | `isReplay` 不存在或 false | SDKUserMessage | 用户消息/工具结果 |
| `user` | `isReplay: true` | SDKUserMessageReplay | 恢复会话时的重放消息 |
| `result` | `subtype: "success"` | SDKResultSuccess | 执行成功（最后一条） |
| `result` | `subtype: "error_*"` | SDKResultError | 执行失败（最后一条） |
| `stream_event` | — | SDKPartialAssistantMessage | 仅 `--include-partial-messages` |
| `tool_progress` | — | SDKToolProgressMessage | 工具执行进度更新 |
| `auth_status` | — | SDKAuthStatusMessage | 认证状态变化 |
| `tool_use_summary` | — | SDKToolUseSummaryMessage | 工具使用摘要 |

### 内部协议消息（`claude -p` 不输出，仅 Agent SDK 内部）

| type 值 | 消息名 | 用途 |
|---------|--------|------|
| `control_request` | SDKControlRequest | SDK→CLI 的控制指令 |
| `control_response` | SDKControlResponse | CLI→SDK 的控制响应 |
| `control_cancel_request` | SDKControlCancelRequest | 取消控制请求 |
| `keep_alive` | SDKKeepAliveMessage | 连接保活 |
| `streamlined_text` | SDKStreamlinedTextMessage | 内部文本精简 |
| `streamlined_tool_use_summary` | SDKStreamlinedToolUseSummaryMessage | 内部工具摘要精简 |

---

## 8. 典型消息序列

### 8.1 简单文本回复（无工具调用）

**不带 `--include-partial-messages`**：
```
system (init)        → 会话初始化
assistant            → 完整回复
result (success)     → 执行完成
```

**带 `--include-partial-messages`**：
```
system (init)        → 会话初始化
stream_event         → message_start
stream_event         → content_block_start (text)
stream_event         → content_block_delta (text_delta: "Hel")
stream_event         → content_block_delta (text_delta: "lo")
assistant            → 完整回复（content 已拼接: "Hello"）
stream_event         → content_block_stop
stream_event         → message_delta (stop_reason, usage)
stream_event         → message_stop
result (success)     → 执行完成
```

### 8.2 工具调用（带 `--include-partial-messages`）

```
system (init)        → 会话初始化
stream_event         → message_start
stream_event         → content_block_start (text)
stream_event         → content_block_delta (text_delta: "让我...")
stream_event         → content_block_stop
stream_event         → content_block_start (tool_use: id, name="Read")
stream_event         → content_block_delta (input_json_delta: '{"file')
stream_event         → content_block_delta (input_json_delta: '_path":"/src/index.ts"}')
assistant            → 完整消息（含 text + tool_use blocks）
stream_event         → content_block_stop
stream_event         → message_delta
stream_event         → message_stop
user                 → 工具结果（content: [{type: "tool_result", ...}]）
stream_event         → message_start (第二轮回复)
stream_event         → content_block_start (text)
stream_event         → content_block_delta (text_delta: "文件内容...")
assistant            → 第二轮完整回复
stream_event         → content_block_stop
stream_event         → message_delta
stream_event         → message_stop
result (success)     → 执行完成
```

### 8.3 多轮对话（--resume）

```
system (init)        → 会话初始化（session_id 与之前相同）
assistant            → 回复
result (success)     → 执行完成
```

### 8.4 错误情况

```
system (init)        → 会话初始化
result (error)       → subtype: "error_during_execution", errors: ["..."]
```

或进程级错误（无 JSON 输出，exit code 非 0，stderr 有错误信息）。

---

## 9. 输入格式（`--input-format`）

| 值 | 说明 |
|----|------|
| `text`（默认） | `--print` 的 prompt 参数作为输入 |
| `stream-json` | 从 stdin 读取 NDJSON，支持多轮实时交互。**必须搭配** `--output-format stream-json` |

`--input-format stream-json` 支持的输入消息类型：
- `SDKUserMessage` — 用户消息
- 控制消息（仅 Agent SDK 内部使用）

`--replay-user-messages` — 仅在 `--input-format stream-json` + `--output-format stream-json` 下生效，将接收到的用户消息回写到 stdout 进行确认。

---

## 10. 项目当前使用方式

### 10.1 CLI 调用参数

```typescript
// src/core/claude.ts
const args = [
  '-p', options.prompt,
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--allowedTools', options.allowedTools,
  '--max-turns', String(options.maxTurns),
]
```

### 10.2 当前解析的消息类型

项目 `parseStream()` 函数当前只处理以下消息类型：

| 消息 | 处理方式 | 对应 ConductorEvent |
|------|---------|-------------------|
| `system` + `subtype: "init"` | 提取 session_id | `session_created` |
| `stream_event` + `delta.type: "text_delta"` | 提取文本片段 | `text_delta` |
| `stream_event` + `content_block_start` (tool_use) | 开始累积工具输入 | — |
| `stream_event` + `delta.type: "input_json_delta"` | 累积 partial JSON | — |
| `stream_event` + `content_block_stop` | 组装工具调用 | `tool_use` |
| `user` (含 tool_result) | 提取工具结果 | `tool_result` |
| `result` | 提取最终结果 | `result` |

### 10.3 当前忽略的消息类型

以下消息类型在 stream-json 输出中可能出现，但项目未处理：

| 消息类型 | 是否需要关注 | 说明 |
|---------|------------|------|
| `assistant` | **是** | 完整消息，当前被 stream_event 逻辑覆盖但未显式处理 |
| `system` + `status` | 可选 | 上下文压缩状态，可展示给用户 |
| `system` + `compact_boundary` | 可选 | 压缩边界标记 |
| `tool_progress` | 可选 | 长时间工具的进度更新 |
| `tool_use_summary` | 可选 | 工具使用摘要 |
| `auth_status` | 低优先级 | 认证状态变化 |
| `system` + `task_notification` | 低优先级 | 子任务通知 |
| `system` + `files_persisted` | 低优先级 | 文件持久化 |
| `system` + `hook_*` | 低优先级 | Hook 相关 |
| `stream_event` + `message_start` | 忽略即可 | 仅影响 stream_event 内部状态 |
| `stream_event` + `message_delta` | 忽略即可 | 可提取 stop_reason |
| `stream_event` + `message_stop` | 忽略即可 | 消息结束标记 |

---

## 11. 类型定义差异：sdk.d.ts vs 实际输出

| 字段 | sdk.d.ts | 实际输出 | 说明 |
|------|---------|---------|------|
| `system.init.fast_mode_state` | 不存在 | `"off"` / `"on"` | 类型定义遗漏 |
| `usage` 内部字段 | `NonNullableUsage`（4 个字段） | 额外含 `server_tool_use`, `service_tier`, `cache_creation`, `inference_geo`, `iterations`, `speed` | 实际 usage 比类型定义丰富得多 |
| `assistant.message.context_management` | 不在 `BetaMessage` 定义中 | `null` 或对象 | Anthropic API 的上下文管理信息 |

**结论**：`sdk.d.ts` 的类型定义是保守的最小集合。实际输出可能包含更多字段。解析时应使用 `.passthrough()` 或宽松解析，避免因新增字段导致解析失败。

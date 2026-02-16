# FACTS.md

已验证的技术事实。所有条目均经过实测确认，作为架构设计和实现的依据。

## Claude Code `-p` 模式

### `--resume` + `--output-format json` + `--output-format stream-json` 可组合使用

**验证时间**：2026-02-16

```bash
# 创建会话
claude -p "说一个数字" --output-format json
# → {"result":"42", "session_id":"2dc11ed7-..."}

# 恢复会话，上下文保持
claude -p "你刚才说的数字是什么？再加1" --resume 2dc11ed7-... --output-format json
# → {"result":"我刚才说的数字是 42，加 1 就是 43。"}

# stream-json 同样兼容
claude -p "42+43等于多少" --resume 2dc11ed7-... --output-format stream-json --verbose
# → 逐行 JSON 输出，包含 system/assistant/result 三种消息类型
```

### Session 与 CWD 强绑定

**验证时间**：2026-02-16

Session 文件存储路径包含编码后的 CWD：
```
~/.claude/projects/-private-tmp/         ← 在 /tmp 下创建的 session
~/.claude/projects/-Users-dennis/        ← 在 ~ 下创建的 session
```

**`--resume` 只能在相同 CWD 下生效。** 在 /tmp 创建的 session，在 ~ 下 resume 会报 `No conversation found`。

```bash
# 在 /tmp 下创建
cd /tmp && claude -p "hello" --output-format json
# → session_id: 5889badf-...

# 在 ~ 下 resume → 失败
cd ~ && claude -p "hi" --resume 5889badf-... --output-format json
# → "No conversation found with session ID: 5889badf-..."

# 在 /tmp 下 resume → 成功
cd /tmp && claude -p "hi" --resume 5889badf-... --output-format json
# → 正常恢复
```

**对 Conductor 的影响**：spawn `claude -p` 时必须通过 `cwd` 选项指定正确的工作目录。恢复 session 时必须使用创建时相同的 CWD。

### CLAUDE.md 只从 CWD 加载，不向上查找

**验证时间**：2026-02-16

在 `/tmp/conductor-test/subdir/` 下启动 `claude -p`，不会自动加载 `/tmp/conductor-test/CLAUDE.md`。只有 CWD 本身的 CLAUDE.md 会被加载。

### 软链接 CLAUDE.md 可被识别

**验证时间**：2026-02-16

在临时目录中创建指向项目 CLAUDE.md 的软链接，Claude Code 正常加载并遵守其中的规则。

```bash
ln -s /path/to/project/CLAUDE.md /tmp/session-dir/CLAUDE.md
cd /tmp/session-dir && claude -p "hello" --output-format json
# → CLAUDE.md 中的规则生效
```

### 临时目录作为 CWD 可行

**验证时间**：2026-02-16

在临时目录下启动 `claude -p`，仍可通过绝对路径读写系统上任何文件。CWD 仅影响：
1. session 文件的存储位置（`~/.claude/projects/<编码后的临时目录路径>/`）
2. 项目级 CLAUDE.md 的加载（临时目录下无 CLAUDE.md 则不加载）
3. 相对路径的起点

```bash
TMPDIR=$(mktemp -d)
cd "$TMPDIR" && claude -p "读取 /Users/dennis/.claude/settings.json" --output-format json --allowedTools "Read"
# → 成功读取，绝对路径不受 CWD 限制
```

### 本地 git clone 到独立目录作为 session CWD 可行

**验证时间**：2026-02-16

```bash
git clone --branch main /path/to/repo /tmp/workspace/session-1
cd /tmp/workspace/session-1 && claude -p "..." --output-format json
# → 正常工作，CWD 为 clone 目录，git 历史完整
```

clone 目录包含完整的 .git、CLAUDE.md 等项目文件。Claude Code 在该目录下可正常操作 git、读写文件。

### 无 `--cwd` 参数

**验证时间**：2026-02-16

`claude --help` 中无 `--cwd` flag。工作目录只能通过 spawn 子进程时的 `cwd` 选项控制：

```typescript
spawn('claude', ['-p', prompt, ...], {
  cwd: '/path/to/project'
})
```

### stream-json 支持逐 token 流式输出

**验证时间**：2026-02-16

使用 `--output-format stream-json --verbose --include-partial-messages` 可获得逐 token 的文本流。

消息序列：
1. `{"type": "system", "subtype": "init", ...}` — 会话初始化
2. `{"type": "stream_event", "event": {"type": "message_start", ...}}` — 消息开始
3. `{"type": "stream_event", "event": {"type": "content_block_start", ...}}` — 内容块开始
4. `{"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": "片段"}}}` — 逐 token 文本
5. `{"type": "assistant", "message": {...}}` — 完整消息（所有 token 拼接后）
6. `{"type": "stream_event", "event": {"type": "content_block_stop", ...}}` — 内容块结束
7. `{"type": "stream_event", "event": {"type": "message_stop", ...}}` — 消息结束
8. `{"type": "result", ...}` — 最终汇总

提取文本片段：`d.event.delta.type === "text_delta"` 时取 `d.event.delta.text`。

### 实测延迟

**验证时间**：2026-02-16

简单任务响应延迟 2-3 秒，远低于预期的 12-15 秒。

### 工具能力全部可用

**验证时间**：2026-02-16

以下工具在 `-p` 模式下均验证通过：Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task（子代理）、并行工具调用、多步骤任务（`--max-turns`）。

## Claude Code 会话存储

### 历史会话可读取

**验证时间**：2026-02-16

- **完整对话**：`~/.claude/projects/<项目>/<session-id>.jsonl`，每行一条 JSON 消息
- **全局历史索引**：`~/.claude/history.jsonl`，每条 prompt 的摘要、session ID、项目路径、时间戳
- **项目列表**：`~/.claude/projects/` 目录名即编码后的项目路径
- **子代理对话**：`~/.claude/projects/<项目>/<session-id>/subagents/*.jsonl`

消息结构：
```json
{
  "type": "user",           // 或 "assistant"
  "timestamp": "2026-02-16T00:45:34.006Z",
  "sessionId": "uuid",
  "message": {
    "role": "user",
    "content": "消息文本"
  }
}
```

## Claude Code 认证

### Agent SDK 不能可靠使用 Max 订阅

**验证时间**：2026-02-16

- Agent SDK 官方推荐使用 `ANTHROPIC_API_KEY`（按量计费）
- 虽然技术上可通过 `CLAUDE_CODE_OAUTH_TOKEN` 使用 Max 订阅，但 Anthropic 官方明确不鼓励
- TypeScript SDK 报告兼容性问题
- 只有 `claude` CLI 本身是 Max 订阅的正统入口

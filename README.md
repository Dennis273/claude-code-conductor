# Conductor

A management and orchestration layer for Claude Code instances. Conductor decouples core session/instance management from presentation, exposing a unified API that any frontend (Telegram bot, Discord bot, Web UI, CLI) can plug into.

## Motivation

Claude Code is a powerful agentic CLI, but it lacks:
- A persistent background service to keep it always-on
- Multi-session management and routing
- A programmable API for external integrations

Conductor fills this gap by wrapping `claude -p` (headless mode) as a service, leveraging Claude Code Max subscriptions for unlimited usage at zero marginal API cost.

## Architecture

```
Presentation Layer (Telegram / Discord / Web UI / CLI)
  │  REST + SSE
  ▼
Conductor Core
  │  claude -p --output-format stream-json
  ▼
Claude Code CLI (Max subscription)
```

### Key Design Decisions

- **`claude -p` as the execution primitive** — Headless mode outputs pure JSON, no terminal parsing needed
- **Max subscription as the auth backbone** — All calls go through the locally authenticated `claude` CLI binary, no API keys required
- **Session isolation via git clone** — Each session gets its own working directory. For project tasks, the repo is cloned and checked out to a specified branch, providing full file isolation and natural CLAUDE.md loading
- **REST + SSE** — Standard HTTP for queries, Server-Sent Events for streaming Claude's responses

## API

| Endpoint | Params | Description |
|----------|--------|-------------|
| `POST /sessions` | `prompt`, `env` (required), `repo`, `branch` (optional) | Create session + send first message, SSE streaming response |
| `POST /sessions/:id/messages` | `prompt` (required) | Send follow-up message, SSE streaming response |
| `POST /sessions/:id/cancel` | — | Cancel running task |
| `GET /sessions` | — | List all sessions |
| `GET /sessions/:id` | — | Get session details and conversation history |
| `GET /health` | — | Service status |

## Configuration

`conductor.yaml`:

```yaml
concurrency: 3                                         # Required: max parallel claude -p processes
workspace_root: "/Users/dennis/.conductor/workspaces"  # Required: root path for session working directories

envs:                                                  # Required: at least one env must be defined
  full:
    allowedTools: "Bash,Read,Edit,Write,Glob,Grep,WebSearch,WebFetch,Task"
    max_turns: 20
    env: {}
  readonly:
    allowedTools: "Read,Glob,Grep,WebSearch"
    max_turns: 5
    env: {}
```

## Verified Capabilities

The following have been tested and confirmed working with `claude -p`:

| Capability | Flag / Tool | Status |
|---|---|---|
| Structured JSON output | `--output-format json` | Verified |
| Streaming JSON output | `--output-format stream-json` | Verified |
| Session resume | `--resume <session-id>` | Verified |
| File read/write/edit | `Read`, `Write`, `Edit` | Verified |
| Shell execution | `Bash` | Verified |
| File/content search | `Glob`, `Grep` | Verified |
| Web search | `WebSearch`, `WebFetch` | Verified |
| Sub-agent delegation | `Task` | Verified |
| Parallel tool calls | Multiple tools per turn | Verified |
| Multi-step tasks | `--max-turns` | Verified |
| Auto-approve tools | `--allowedTools` | Verified |
| Symlinked CLAUDE.md | `ln -s` in session CWD | Verified |
| Session-CWD binding | `--resume` requires same CWD | Verified |

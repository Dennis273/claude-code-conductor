// Conductor API client

const API_BASE = ""

// --- Types ---

export interface SessionMetadata {
  session_id: string
  workspace: string
  env: string
  repo: string | null
  branch: string | null
  status: "idle" | "running" | "cancelled"
  title: string
  created_at: string
  last_active_at: string
  message_count: number
}

export interface TextBlock {
  type: "text"
  text: string
}

export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string
  is_error: boolean
}

export interface RawMessageBlock {
  type: "raw_message"
  message_type: string
  raw: Record<string, unknown>
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | RawMessageBlock

export interface Message {
  role: "user" | "assistant"
  content: ContentBlock[]
  timestamp: string
}

export interface SessionDetail extends SessionMetadata {
  messages: Message[]
}

export interface HealthInfo {
  status: string
  running_tasks: number
  concurrency_limit: number
  active_sessions: number
  envs: string[]
}

// SSE event types matching backend ConductorEvent
export type SSEEvent =
  | { type: "session_created"; session_id: string; workspace: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean }
  | {
      type: "result"
      subtype: string
      is_error: boolean
      result: string
      num_turns: number
      cost_usd: number
      errors: string[]
    }
  | { type: "error"; code: string; message: string }
  | { type: "raw_message"; message_type: string; raw: Record<string, unknown> }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

function toSSEEvent(eventType: string, parsed: object): SSEEvent | null {
  if (!isRecord(parsed)) return null

  switch (eventType) {
    case "session_created":
      return {
        type: "session_created",
        session_id: String(parsed.session_id ?? ""),
        workspace: String(parsed.workspace ?? ""),
      }
    case "text_delta":
      return {
        type: "text_delta",
        text: String(parsed.text ?? ""),
      }
    case "tool_use": {
      const input = parsed.input
      return {
        type: "tool_use",
        id: String(parsed.id ?? ""),
        tool: String(parsed.tool ?? ""),
        input: isRecord(input) ? input : {},
      }
    }
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: String(parsed.tool_use_id ?? ""),
        content: String(parsed.content ?? ""),
        is_error: Boolean(parsed.is_error),
      }
    case "result":
      return {
        type: "result",
        subtype: String(parsed.subtype ?? "success"),
        is_error: Boolean(parsed.is_error),
        result: String(parsed.result ?? ""),
        num_turns: Number(parsed.num_turns ?? 0),
        cost_usd: Number(parsed.cost_usd ?? 0),
        errors: Array.isArray(parsed.errors) ? parsed.errors.map(String) : [],
      }
    case "error":
      return {
        type: "error",
        code: String(parsed.code ?? ""),
        message: String(parsed.message ?? ""),
      }
    case "raw_message":
      return {
        type: "raw_message",
        message_type: String(parsed.message_type ?? "unknown"),
        raw: isRecord(parsed.raw) ? parsed.raw : {},
      }
    default:
      return null
  }
}

// --- SSE Parser (GET /sessions/:id/events) ---

export async function* subscribeEvents(
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/events`, {
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(
      err?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`,
    )
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split("\n\n")
    buffer = parts.pop()!

    for (const part of parts) {
      if (!part.trim()) continue

      let eventType = ""
      let data = ""

      for (const line of part.split("\n")) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
          data = line.slice(5).trim()
        }
      }

      if (!eventType || !data) continue

      try {
        const parsed: unknown = JSON.parse(data)
        if (typeof parsed !== "object" || parsed === null) continue
        const event = toSSEEvent(eventType, parsed)
        if (event) yield event
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

// --- REST API ---

export async function createSession(body: {
  prompt: string
  env: string
  repo?: string
  branch?: string
}): Promise<{ session_id: string; workspace: string }> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(
      err?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`,
    )
  }
  return res.json()
}

export async function sendMessage(
  sessionId: string,
  prompt: string,
): Promise<{ session_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(
      err?.error?.message ?? `HTTP ${res.status}: ${res.statusText}`,
    )
  }
  return res.json()
}

export async function getHealth(): Promise<HealthInfo> {
  const res = await fetch(`${API_BASE}/health`)
  if (!res.ok) {
    throw new Error(`Backend unreachable (HTTP ${res.status})`)
  }
  return res.json()
}

export async function getSessions(): Promise<SessionMetadata[]> {
  const res = await fetch(`${API_BASE}/sessions`)
  if (!res.ok) {
    throw new Error(`Failed to fetch sessions (HTTP ${res.status})`)
  }
  const data = await res.json()
  return data.sessions
}

export async function getSession(id: string): Promise<SessionDetail> {
  const res = await fetch(`${API_BASE}/sessions/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function cancelSession(
  id: string,
): Promise<{ session_id: string; status: string }> {
  const res = await fetch(`${API_BASE}/sessions/${id}/cancel`, {
    method: "POST",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
  }
  return res.json()
}

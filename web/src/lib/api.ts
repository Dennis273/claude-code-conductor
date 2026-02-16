// Conductor API client with SSE streaming support

const API_BASE = ""

// --- Types ---

export interface SessionMetadata {
  session_id: string
  workspace: string
  env: string
  repo: string | null
  branch: string | null
  status: "idle" | "running" | "cancelled"
  created_at: string
  last_active_at: string
  message_count: number
}

export interface MessageEntry {
  role: "user" | "assistant" | "tool_use" | "tool_result"
  content: string
  tool?: string
  input?: Record<string, unknown>
  is_error?: boolean
  timestamp: string
}

export interface SessionDetail extends SessionMetadata {
  messages: MessageEntry[]
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
  | { type: "tool_use"; tool: string; input: Record<string, unknown> }
  | { type: "tool_result"; content: string; is_error: boolean }
  | {
      type: "result"
      result: string
      num_turns: number
      cost_usd: number
    }
  | { type: "error"; code: string; message: string }

// --- SSE Parser ---

export async function* streamSSE(
  url: string,
  body: object,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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

    // Parse SSE format: "event: <type>\ndata: <json>\n\n"
    const parts = buffer.split("\n\n")
    // Keep the last incomplete part in the buffer
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
        const parsed = JSON.parse(data)
        yield { type: eventType, ...parsed } as SSEEvent
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

// --- REST API ---

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

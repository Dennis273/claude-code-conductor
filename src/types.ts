// --- Streaming events (from claude.ts parser) ---

export interface SessionCreatedEvent {
  type: 'session_created'
  session_id: string
  workspace: string
}

export interface TextDeltaEvent {
  type: 'text_delta'
  text: string
}

export interface ToolUseEvent {
  type: 'tool_use'
  id: string
  tool: string
  input: Record<string, unknown>
}

export interface ToolResultEvent {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error: boolean
}

export interface ResultEvent {
  type: 'result'
  subtype: string
  is_error: boolean
  result: string
  session_id: string
  num_turns: number
  cost_usd: number
  errors: string[]
}

export interface ErrorEvent {
  type: 'error'
  code: string
  message: string
}

export interface RawMessageEvent {
  type: 'raw_message'
  message_type: string
  raw: Record<string, unknown>
}

export type ConductorEvent =
  | SessionCreatedEvent
  | TextDeltaEvent
  | ToolUseEvent
  | ToolResultEvent
  | ResultEvent
  | ErrorEvent
  | RawMessageEvent

export interface PromptOptions {
  prompt: string
  cwd: string
  allowedTools: string
  maxTurns: number
  env: Record<string, string>
  resumeSessionId?: string
}

export interface PromptHandle {
  events: AsyncGenerator<ConductorEvent>
  abort: () => void
}

// --- Content blocks (Anthropic API / Claude Code format) ---

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error: boolean
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

// --- Conversation message (CC-compatible) ---

export interface Message {
  role: 'user' | 'assistant'
  content: ContentBlock[]
  timestamp: string
}

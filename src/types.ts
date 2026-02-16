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
  tool: string
  input: Record<string, unknown>
}

export interface ToolResultEvent {
  type: 'tool_result'
  content: string
  is_error: boolean
}

export interface ResultEvent {
  type: 'result'
  result: string
  session_id: string
  num_turns: number
  cost_usd: number
}

export interface ErrorEvent {
  type: 'error'
  code: string
  message: string
}

export type ConductorEvent =
  | SessionCreatedEvent
  | TextDeltaEvent
  | ToolUseEvent
  | ToolResultEvent
  | ResultEvent
  | ErrorEvent

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

export interface MessageEntry {
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result'
  content: string
  tool?: string
  input?: Record<string, unknown>
  is_error?: boolean
  timestamp: string
}

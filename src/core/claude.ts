import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { ConductorEvent, PromptOptions, PromptHandle } from '../types.js'

export function executePrompt(options: PromptOptions): PromptHandle {
  const abortController = new AbortController()

  const q = query({
    prompt: options.prompt,
    options: {
      cwd: options.cwd,
      allowedTools: options.allowedTools,
      maxTurns: options.maxTurns,
      env: { ...process.env, CLAUDECODE: '', ...options.env },
      resume: options.resumeSessionId,
      abortController,
      includePartialMessages: true,
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    },
  })

  const abort = () => {
    abortController.abort()
  }

  async function* streamEvents(): AsyncGenerator<ConductorEvent> {
    try {
      yield* adaptSDKMessages(q, options.cwd)
    } catch (err: unknown) {
      if (isAbortError(err)) return
      throw err
    }
  }

  return { events: streamEvents(), abort }
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true
  if (err instanceof Error && err.name === 'AbortError') return true
  return false
}

// --- Stream event field accessors (runtime duck typing for BetaRawMessageStreamEvent) ---

interface StreamEventDelta {
  type: string
  text?: string
  partial_json?: string
}

interface StreamEventContentBlock {
  type: string
  id?: string
  name?: string
}

function getEventDelta(event: unknown): StreamEventDelta | null {
  if (typeof event !== 'object' || event === null) return null
  if (!('delta' in event)) return null
  const d = (event as Record<string, unknown>).delta
  if (typeof d !== 'object' || d === null) return null
  if (!('type' in d) || typeof (d as Record<string, unknown>).type !== 'string') return null
  return d as StreamEventDelta
}

function getEventContentBlock(event: unknown): StreamEventContentBlock | null {
  if (typeof event !== 'object' || event === null) return null
  if (!('content_block' in event)) return null
  const cb = (event as Record<string, unknown>).content_block
  if (typeof cb !== 'object' || cb === null) return null
  if (!('type' in cb) || typeof (cb as Record<string, unknown>).type !== 'string') return null
  return cb as StreamEventContentBlock
}

function getEventType(event: unknown): string | null {
  if (typeof event !== 'object' || event === null) return null
  if (!('type' in event) || typeof (event as Record<string, unknown>).type !== 'string') return null
  return (event as Record<string, unknown>).type as string
}

// --- SDK Message → ConductorEvent adapter ---

async function* adaptSDKMessages(
  q: AsyncIterable<SDKMessage>,
  workspace: string,
): AsyncGenerator<ConductorEvent> {
  // Tool input accumulation state (same as old parser)
  let pendingToolId = ''
  let pendingToolName = ''
  let pendingToolInput = ''

  for await (const msg of q) {
    switch (msg.type) {
      // --- system init → session_created ---
      case 'system': {
        const sys = msg as SDKSystemMessage
        if (sys.subtype === 'init') {
          yield { type: 'session_created', session_id: sys.session_id, workspace }
        }
        break
      }

      // --- stream_event (partial messages) → text_delta / tool_use ---
      case 'stream_event': {
        const partial = msg as SDKPartialAssistantMessage
        const event = partial.event
        const eventType = getEventType(event)

        // content_block_delta
        if (eventType === 'content_block_delta') {
          const delta = getEventDelta(event)
          if (delta) {
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              yield { type: 'text_delta', text: delta.text }
              break
            }
            if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              pendingToolInput += delta.partial_json
              break
            }
          }
        }

        // content_block_start (tool_use)
        if (eventType === 'content_block_start') {
          const cb = getEventContentBlock(event)
          if (cb && cb.type === 'tool_use' && typeof cb.id === 'string' && typeof cb.name === 'string') {
            pendingToolId = cb.id
            pendingToolName = cb.name
            pendingToolInput = ''
          }
          break
        }

        // content_block_stop → emit accumulated tool_use
        if (eventType === 'content_block_stop' && pendingToolName) {
          let input: Record<string, unknown> = {}
          try { input = JSON.parse(pendingToolInput) } catch { /* empty input */ }
          yield {
            type: 'tool_use',
            id: pendingToolId,
            tool: pendingToolName,
            input,
          }
          pendingToolId = ''
          pendingToolName = ''
          pendingToolInput = ''
        }
        break
      }

      // --- user message (tool_result blocks) ---
      case 'user': {
        const userMsg = msg as SDKUserMessage | SDKUserMessageReplay
        if ('isReplay' in userMsg && userMsg.isReplay) break
        const content = userMsg.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_result') {
              const tr = block as { tool_use_id?: string; content?: unknown; is_error?: boolean }
              yield {
                type: 'tool_result',
                tool_use_id: typeof tr.tool_use_id === 'string' ? tr.tool_use_id : '',
                content: typeof tr.content === 'string' ? tr.content : '',
                is_error: typeof tr.is_error === 'boolean' ? tr.is_error : false,
              }
            }
          }
        }
        break
      }

      // --- result → result / error ---
      case 'result': {
        const res = msg as SDKResultMessage
        if (res.is_error) {
          const errResult = res as SDKResultMessage & { errors?: string[] }
          yield {
            type: 'result',
            subtype: res.subtype,
            is_error: true,
            result: '',
            session_id: res.session_id,
            num_turns: res.num_turns,
            cost_usd: res.total_cost_usd,
            errors: Array.isArray(errResult.errors) ? errResult.errors : [],
          }
        } else {
          const successResult = res as SDKResultMessage & { result?: string }
          yield {
            type: 'result',
            subtype: res.subtype,
            is_error: false,
            result: typeof successResult.result === 'string' ? successResult.result : '',
            session_id: res.session_id,
            num_turns: res.num_turns,
            cost_usd: res.total_cost_usd,
            errors: [],
          }
        }
        break
      }

      // --- catch-all: forward unrecognized messages as raw_message ---
      default: {
        yield {
          type: 'raw_message',
          message_type: typeof msg.type === 'string' ? msg.type : 'unknown',
          raw: msg as unknown as Record<string, unknown>,
        }
      }
    }
  }
}

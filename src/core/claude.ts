import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import type { ConductorEvent, PromptOptions, PromptHandle } from '../types.js'

export function executePrompt(options: PromptOptions): PromptHandle {
  const args = [
    '-p',
    options.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--allowedTools',
    options.allowedTools,
    '--max-turns',
    String(options.maxTurns),
  ]

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId)
  }

  const child = spawn('claude', args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      CLAUDECODE: '',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const abort = () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
    }
  }

  async function* streamEvents(): AsyncGenerator<ConductorEvent> {
    try {
      yield* parseStream(child, options.cwd)
    } finally {
      abort()
    }
  }

  return { events: streamEvents(), abort }
}

// --- Zod schemas for Claude CLI stream-json output ---

const InitEvent = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string(),
})

const ToolUseContentBlock = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
})

const ContentBlockStart = z.object({
  type: z.literal('content_block_start'),
  content_block: ToolUseContentBlock,
})

const InputJsonDelta = z.object({
  type: z.literal('input_json_delta'),
  partial_json: z.string(),
})

const TextDelta = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
})

const ContentBlockStop = z.object({
  type: z.literal('content_block_stop'),
})

const StreamEvent = z.object({
  type: z.literal('stream_event'),
  event: z.object({}).passthrough(),
})

const ToolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string().optional().default(''),
  is_error: z.boolean().optional().default(false),
})

const UserMessage = z.object({
  type: z.literal('user'),
  message: z.object({
    content: z.array(ToolResultBlock),
  }),
})

const ResultMessage = z.object({
  type: z.literal('result'),
  subtype: z.string().optional().default('success'),
  is_error: z.boolean().optional().default(false),
  session_id: z.string().optional(),
  result: z.string().optional().default(''),
  num_turns: z.number().optional().default(0),
  total_cost_usd: z.number().optional().default(0),
  errors: z.array(z.string()).optional().default([]),
})

const ToolInput = z.record(z.string(), z.unknown())

// --- Parser ---

async function* parseStream(
  child: ChildProcess,
  workspace: string,
): AsyncGenerator<ConductorEvent> {
  const rl = createInterface({ input: child.stdout! })

  let sessionId = ''
  const stderrChunks: string[] = []

  // Accumulate tool_use input from input_json_delta events
  let pendingToolId = ''
  let pendingToolName = ''
  let pendingToolInput = ''

  child.stderr!.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString())
  })

  for await (const line of rl) {
    if (!line.trim()) continue

    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }

    // --- system init ---
    const initResult = InitEvent.safeParse(raw)
    if (initResult.success) {
      sessionId = initResult.data.session_id
      yield { type: 'session_created', session_id: sessionId, workspace }
      continue
    }

    // --- stream_event ---
    const streamResult = StreamEvent.safeParse(raw)
    if (streamResult.success) {
      const event = streamResult.data.event
      const delta = 'delta' in event && typeof event.delta === 'object' && event.delta !== null
        ? event.delta
        : null

      // text_delta
      if (delta) {
        const textResult = TextDelta.safeParse(delta)
        if (textResult.success) {
          yield { type: 'text_delta', text: textResult.data.text }
          continue
        }
      }

      // content_block_start (tool_use)
      const blockStartResult = ContentBlockStart.safeParse(event)
      if (blockStartResult.success) {
        pendingToolId = blockStartResult.data.content_block.id
        pendingToolName = blockStartResult.data.content_block.name
        pendingToolInput = ''
        continue
      }

      // input_json_delta
      if (delta) {
        const inputDeltaResult = InputJsonDelta.safeParse(delta)
        if (inputDeltaResult.success) {
          pendingToolInput += inputDeltaResult.data.partial_json
          continue
        }
      }

      // content_block_stop
      if (pendingToolName) {
        const stopResult = ContentBlockStop.safeParse(event)
        if (stopResult.success) {
          const inputResult = ToolInput.safeParse(
            (() => { try { return JSON.parse(pendingToolInput) } catch { return {} } })()
          )
          yield {
            type: 'tool_use',
            id: pendingToolId,
            tool: pendingToolName,
            input: inputResult.success ? inputResult.data : {},
          }
          pendingToolId = ''
          pendingToolName = ''
          pendingToolInput = ''
          continue
        }
      }

      continue
    }

    // --- user message (tool_result) ---
    const userResult = UserMessage.safeParse(raw)
    if (userResult.success) {
      for (const block of userResult.data.message.content) {
        yield {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.is_error,
        }
      }
      continue
    }

    // --- result ---
    const resultResult = ResultMessage.safeParse(raw)
    if (resultResult.success) {
      sessionId = resultResult.data.session_id ?? sessionId
      yield {
        type: 'result',
        subtype: resultResult.data.subtype,
        is_error: resultResult.data.is_error,
        result: resultResult.data.result,
        session_id: sessionId,
        num_turns: resultResult.data.num_turns,
        cost_usd: resultResult.data.total_cost_usd,
        errors: resultResult.data.errors,
      }
      continue
    }

    // --- catch-all: forward unrecognized messages as raw_message ---
    if (typeof raw === 'object' && raw !== null) {
      const record: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(raw)) {
        record[k] = v
      }
      yield {
        type: 'raw_message',
        message_type: typeof record.type === 'string' ? record.type : 'unknown',
        raw: record,
      }
    }
  }

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode)
    } else {
      child.on('exit', (code) => resolve(code))
    }
  })

  if (exitCode !== 0 && exitCode !== null) {
    const stderr = stderrChunks.join('')
    yield {
      type: 'error',
      code: 'CLAUDE_ERROR',
      message: stderr || `claude process exited with code ${exitCode}`,
    }
  }
}

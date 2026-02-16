import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
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

async function* parseStream(
  child: ChildProcess,
  workspace: string,
): AsyncGenerator<ConductorEvent> {
  const rl = createInterface({ input: child.stdout! })

  let sessionId = ''
  let stderrChunks: string[] = []

  // Accumulate tool_use input from input_json_delta events
  let pendingToolName = ''
  let pendingToolInput = ''

  child.stderr!.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString())
  })

  for await (const line of rl) {
    if (!line.trim()) continue

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    const type = parsed.type as string

    if (type === 'system' && parsed.subtype === 'init') {
      sessionId = parsed.session_id as string
      yield {
        type: 'session_created',
        session_id: sessionId,
        workspace,
      }
      continue
    }

    if (type === 'stream_event') {
      const event = parsed.event as Record<string, unknown> | undefined
      if (!event) continue

      const delta = event.delta as Record<string, unknown> | undefined

      if (delta?.type === 'text_delta') {
        yield {
          type: 'text_delta',
          text: delta.text as string,
        }
        continue
      }

      if (event.type === 'content_block_start') {
        const contentBlock = event.content_block as Record<string, unknown> | undefined
        if (contentBlock?.type === 'tool_use') {
          pendingToolName = contentBlock.name as string
          pendingToolInput = ''
        }
        continue
      }

      if (delta?.type === 'input_json_delta') {
        pendingToolInput += delta.partial_json as string
        continue
      }

      if (event.type === 'content_block_stop' && pendingToolName) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(pendingToolInput) as Record<string, unknown>
        } catch {
          // partial JSON failed to parse, yield what we have
        }
        yield {
          type: 'tool_use',
          tool: pendingToolName,
          input,
        }
        pendingToolName = ''
        pendingToolInput = ''
        continue
      }

      continue
    }

    if (type === 'user') {
      const message = parsed.message as Record<string, unknown> | undefined
      const content = message?.content as Array<Record<string, unknown>> | undefined
      if (content) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            yield {
              type: 'tool_result',
              content: (block.content as string) ?? '',
              is_error: (block.is_error as boolean) ?? false,
            }
          }
        }
      }
      continue
    }

    if (type === 'result') {
      sessionId = (parsed.session_id as string) || sessionId
      yield {
        type: 'result',
        result: (parsed.result as string) ?? '',
        session_id: sessionId,
        num_turns: (parsed.num_turns as number) ?? 0,
        cost_usd: (parsed.total_cost_usd as number) ?? 0,
      }
      continue
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


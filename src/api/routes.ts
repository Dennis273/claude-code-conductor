import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Config } from '../config.js'
import { executePrompt } from '../core/claude.js'
import {
  createWorkspace,
  writeMcpConfig,
  saveSession,
  getSession,
  updateSessionStatus,
  updateSessionTitle,
  updateRunMessageOffset,
  listSessions,
  appendContentBlock,
  getMessages,
} from '../core/session.js'
import { generateTitle } from '../core/title.js'
import {
  createBus,
  getBus,
  removeBus,
  publish,
  subscribe,
  markDone,
} from '../core/event-bus.js'
import { formatSSEData } from './sse-format.js'
import type { ConductorEvent } from '../types.js'

let runningCount = 0
const runningProcesses = new Map<string, () => void>()

const BUS_CLEANUP_DELAY_MS = 60_000

export function getRunningCount(): number {
  return runningCount
}

export function forceAbortAll(): void {
  for (const abort of runningProcesses.values()) {
    abort()
  }
}

/**
 * Background consumer: drives the claude process lifecycle independently of HTTP connections.
 * Consumes events from the async generator, persists them, and publishes to EventBus.
 */
function startBackgroundConsumer(
  sessionId: string,
  events: AsyncGenerator<ConductorEvent>,
  config: Config,
): void {
  ;(async () => {
    let accumulatedText = ''

    try {
      for await (const event of events) {
        if (event.type === 'text_delta') {
          accumulatedText += event.text
        } else if (event.type === 'tool_use') {
          if (accumulatedText) {
            appendContentBlock(config.workspace_root, sessionId, 'assistant', {
              type: 'text',
              text: accumulatedText,
            })
            accumulatedText = ''
          }
          appendContentBlock(config.workspace_root, sessionId, 'assistant', {
            type: 'tool_use',
            id: event.id,
            name: event.tool,
            input: event.input,
          })
        } else if (event.type === 'tool_result') {
          appendContentBlock(config.workspace_root, sessionId, 'user', {
            type: 'tool_result',
            tool_use_id: event.tool_use_id,
            content: event.content,
            is_error: event.is_error,
          })
        } else if (event.type === 'result') {
          if (accumulatedText) {
            appendContentBlock(config.workspace_root, sessionId, 'assistant', {
              type: 'text',
              text: accumulatedText,
            })
            accumulatedText = ''
          }
        }

        publish(sessionId, event)
      }
    } finally {
      // Flush any remaining text
      if (accumulatedText) {
        appendContentBlock(config.workspace_root, sessionId, 'assistant', {
          type: 'text',
          text: accumulatedText,
        })
      }

      runningCount--
      runningProcesses.delete(sessionId)

      const session = getSession(config.workspace_root, sessionId)
      if (session && session.status === 'running') {
        updateSessionStatus(config.workspace_root, sessionId, 'idle')
      }

      markDone(sessionId)

      // Keep bus alive for late subscribers, then clean up
      setTimeout(() => removeBus(sessionId), BUS_CLEANUP_DELAY_MS)
    }
  })()
}

export function createRoutes(config: Config): Hono {
  const app = new Hono()

  // POST /sessions — create session + send first message, returns JSON
  app.post('/sessions', async (c) => {
    const body = await c.req.json()
    const { prompt, env, repo, branch } = body

    if (!prompt) {
      return c.json(
        { error: { code: 'MISSING_FIELD', message: 'prompt is required' } },
        400,
      )
    }
    if (!env) {
      return c.json(
        { error: { code: 'MISSING_FIELD', message: 'env is required' } },
        400,
      )
    }

    const envConfig = config.envs[env]
    if (!envConfig) {
      return c.json(
        {
          error: {
            code: 'INVALID_ENV',
            message: `env '${env}' not found in configuration`,
          },
        },
        400,
      )
    }

    if (runningCount >= config.concurrency) {
      return c.json(
        {
          error: {
            code: 'CONCURRENCY_LIMIT',
            message: 'concurrency limit reached',
          },
        },
        503,
      )
    }

    let workspacePath: string
    try {
      const result = createWorkspace(config.workspace_root, repo, branch)
      workspacePath = result.workspacePath
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return c.json({ error: { code: 'CLONE_FAILED', message } }, 500)
    }

    if (envConfig.mcpServers) {
      writeMcpConfig(workspacePath, envConfig.mcpServers)
    }

    let allowedTools = envConfig.allowedTools
    if (envConfig.mcpServers) {
      const mcpPatterns = Object.keys(envConfig.mcpServers).map(name => `mcp__${name}__*`)
      allowedTools = [allowedTools, ...mcpPatterns].join(',')
    }

    runningCount++

    const handle = executePrompt({
      prompt,
      cwd: workspacePath,
      allowedTools,
      maxTurns: envConfig.max_turns,
      env: envConfig.env,
    })

    // Consume the first event to get session_id before returning JSON
    try {
      const firstResult = await handle.events.next()
      if (firstResult.done) {
        runningCount--
        return c.json(
          {
            error: {
              code: 'SESSION_CREATE_FAILED',
              message: 'claude process ended without session_created',
            },
          },
          500,
        )
      }

      const firstEvent = firstResult.value
      if (firstEvent.type !== 'session_created') {
        runningCount--
        return c.json(
          {
            error: {
              code: 'SESSION_CREATE_FAILED',
              message: `expected session_created, got ${firstEvent.type}`,
            },
          },
          500,
        )
      }

      const sessionId = firstEvent.session_id
      runningProcesses.set(sessionId, handle.abort)

      createBus(sessionId)

      const now = new Date().toISOString()
      const fallbackTitle = prompt.slice(0, 80)
      saveSession(config.workspace_root, sessionId, {
        workspace: workspacePath,
        env,
        repo: repo ?? null,
        branch: branch ?? null,
        status: 'running',
        title: fallbackTitle,
        created_at: now,
        last_active_at: now,
        run_message_offset: 1,
      })

      generateTitle(prompt).then((title) => {
        if (title) {
          updateSessionTitle(config.workspace_root, sessionId, title)
        }
      })

      appendContentBlock(config.workspace_root, sessionId, 'user', {
        type: 'text',
        text: prompt,
      })

      // Publish session_created to bus, then hand off remaining events to background consumer
      publish(sessionId, firstEvent)
      startBackgroundConsumer(sessionId, handle.events, config)

      return c.json({ session_id: sessionId, workspace: workspacePath })
    } catch (err) {
      runningCount--
      const message = err instanceof Error ? err.message : String(err)
      return c.json(
        { error: { code: 'SESSION_CREATE_FAILED', message } },
        500,
      )
    }
  })

  // POST /sessions/:id/messages — send follow-up message, returns JSON
  app.post('/sessions/:id/messages', async (c) => {
    const sessionId = c.req.param('id')
    const body = await c.req.json()
    const { prompt } = body

    if (!prompt) {
      return c.json(
        { error: { code: 'MISSING_FIELD', message: 'prompt is required' } },
        400,
      )
    }

    const session = getSession(config.workspace_root, sessionId)
    if (!session) {
      return c.json(
        {
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `session '${sessionId}' not found`,
          },
        },
        404,
      )
    }

    if (runningProcesses.has(sessionId)) {
      return c.json(
        {
          error: {
            code: 'SESSION_BUSY',
            message: 'session is currently running',
          },
        },
        409,
      )
    }

    if (runningCount >= config.concurrency) {
      return c.json(
        {
          error: {
            code: 'CONCURRENCY_LIMIT',
            message: 'concurrency limit reached',
          },
        },
        503,
      )
    }

    const envConfig = config.envs[session.env]

    let allowedTools = envConfig.allowedTools
    if (envConfig.mcpServers) {
      const mcpPatterns = Object.keys(envConfig.mcpServers).map(name => `mcp__${name}__*`)
      allowedTools = [allowedTools, ...mcpPatterns].join(',')
    }

    runningCount++
    updateSessionStatus(config.workspace_root, sessionId, 'running')

    appendContentBlock(config.workspace_root, sessionId, 'user', {
      type: 'text',
      text: prompt,
    })

    const offset = getMessages(config.workspace_root, sessionId).length
    updateRunMessageOffset(config.workspace_root, sessionId, offset)

    const handle = executePrompt({
      prompt,
      cwd: session.workspace,
      allowedTools,
      maxTurns: envConfig.max_turns,
      env: envConfig.env,
      resumeSessionId: sessionId,
    })

    runningProcesses.set(sessionId, handle.abort)

    // Create EventBus and start background consumer
    createBus(sessionId)

    // Wrap generator to skip session_created on resume
    async function* skipSessionCreated() {
      for await (const event of handle.events) {
        if (event.type === 'session_created') continue
        yield event
      }
    }

    startBackgroundConsumer(sessionId, skipSessionCreated(), config)

    return c.json({ session_id: sessionId, status: 'running' })
  })

  // GET /sessions/:id/events — SSE stream with replay
  app.get('/sessions/:id/events', (c) => {
    const sessionId = c.req.param('id')

    const bus = getBus(sessionId)
    if (!bus) {
      return c.json(
        {
          error: {
            code: 'NO_ACTIVE_STREAM',
            message: `no active event stream for session '${sessionId}'`,
          },
        },
        404,
      )
    }

    return streamSSE(c, async (stream) => {
      let streamClosed = false

      const unsub = subscribe(sessionId, (event) => {
        if (streamClosed) return
        const sse = formatSSEData(event)
        stream.writeSSE(sse).catch(() => {
          streamClosed = true
        })
      })

      // Wait until the bus is done or the client disconnects
      await new Promise<void>((resolve) => {
        // Check if already done (all events were replayed synchronously)
        if (bus.done) {
          resolve()
          return
        }

        // Poll for bus.done or client abort
        const interval = setInterval(() => {
          if (bus.done || streamClosed) {
            clearInterval(interval)
            resolve()
          }
        }, 100)

        stream.onAbort(() => {
          streamClosed = true
          clearInterval(interval)
          resolve()
        })
      })

      unsub()
    })
  })

  // POST /sessions/:id/cancel
  app.post('/sessions/:id/cancel', async (c) => {
    const sessionId = c.req.param('id')

    const session = getSession(config.workspace_root, sessionId)
    if (!session) {
      return c.json(
        {
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `session '${sessionId}' not found`,
          },
        },
        404,
      )
    }

    const abortFn = runningProcesses.get(sessionId)
    if (!abortFn) {
      return c.json(
        {
          error: {
            code: 'SESSION_IDLE',
            message: 'session is not running',
          },
        },
        409,
      )
    }

    abortFn()
    updateSessionStatus(config.workspace_root, sessionId, 'cancelled')

    return c.json({ session_id: sessionId, status: 'cancelled' })
  })

  // GET /sessions
  app.get('/sessions', (c) => {
    const store = listSessions(config.workspace_root)
    const sessions = Object.entries(store).map(([id, meta]) => ({
      session_id: id,
      ...meta,
      message_count: getMessages(config.workspace_root, id).length,
    }))
    return c.json({ sessions })
  })

  // GET /sessions/:id
  app.get('/sessions/:id', (c) => {
    const sessionId = c.req.param('id')
    const session = getSession(config.workspace_root, sessionId)
    if (!session) {
      return c.json(
        {
          error: {
            code: 'SESSION_NOT_FOUND',
            message: `session '${sessionId}' not found`,
          },
        },
        404,
      )
    }

    return c.json({
      session_id: sessionId,
      ...session,
      messages: getMessages(config.workspace_root, sessionId),
    })
  })

  // GET /health
  app.get('/health', (c) => {
    const store = listSessions(config.workspace_root)
    return c.json({
      status: 'ok',
      running_tasks: runningCount,
      concurrency_limit: config.concurrency,
      active_sessions: Object.keys(store).length,
      envs: Object.keys(config.envs),
    })
  })

  // Static files — serve web/dist/ for production Web UI
  app.use('*', serveStatic({ root: './web/dist' }))

  // SPA fallback — serve index.html for client-side routes
  app.use('*', serveStatic({ root: './web/dist', path: 'index.html' }))

  return app
}

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Config } from '../config.js'
import { executePrompt } from '../core/claude.js'
import {
  createWorkspace,
  saveSession,
  getSession,
  updateSessionStatus,
  listSessions,
  appendMessage,
  getMessages,
} from '../core/session.js'

let runningCount = 0
const runningProcesses = new Map<string, () => void>()

export function getRunningCount(): number {
  return runningCount
}

export function forceAbortAll(): void {
  for (const abort of runningProcesses.values()) {
    abort()
  }
}

export function createRoutes(config: Config): Hono {
  const app = new Hono()

  // POST /sessions — create session + send first message
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

    runningCount++

    const { events, abort } = executePrompt({
      prompt,
      cwd: workspacePath,
      allowedTools: envConfig.allowedTools,
      maxTurns: envConfig.max_turns,
      env: envConfig.env,
    })

    return streamSSE(c, async (stream) => {
      let sessionId = ''

      try {
        for await (const event of events) {
          if (event.type === 'session_created') {
            sessionId = event.session_id
            runningProcesses.set(sessionId, abort)

            const now = new Date().toISOString()
            saveSession(config.workspace_root, sessionId, {
              workspace: workspacePath,
              env,
              repo: repo ?? null,
              branch: branch ?? null,
              status: 'running',
              created_at: now,
              last_active_at: now,
            })

            appendMessage(config.workspace_root, sessionId, {
              role: 'user',
              content: prompt,
              timestamp: now,
            })

            await stream.writeSSE({
              event: 'session_created',
              data: JSON.stringify({
                session_id: sessionId,
                workspace: workspacePath,
              }),
            })
          } else if (event.type === 'text_delta') {
            await stream.writeSSE({
              event: 'text_delta',
              data: JSON.stringify({ text: event.text }),
            })
          } else if (event.type === 'tool_use') {
            await stream.writeSSE({
              event: 'tool_use',
              data: JSON.stringify({
                tool: event.tool,
                input: event.input,
              }),
            })
          } else if (event.type === 'result') {
            if (!sessionId) sessionId = event.session_id

            appendMessage(config.workspace_root, sessionId, {
              role: 'assistant',
              content: event.result,
              timestamp: new Date().toISOString(),
            })

            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify({
                result: event.result,
                num_turns: event.num_turns,
                cost_usd: event.cost_usd,
              }),
            })
          } else if (event.type === 'error') {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                code: event.code,
                message: event.message,
              }),
            })
          }
        }
      } finally {
        runningCount--
        runningProcesses.delete(sessionId)
        if (sessionId) {
          const session = getSession(config.workspace_root, sessionId)
          if (session && session.status === 'running') {
            updateSessionStatus(config.workspace_root, sessionId, 'idle')
          }
        }
      }
    })
  })

  // POST /sessions/:id/messages — send follow-up message
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

    runningCount++
    updateSessionStatus(config.workspace_root, sessionId, 'running')

    appendMessage(config.workspace_root, sessionId, {
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString(),
    })

    const { events, abort } = executePrompt({
      prompt,
      cwd: session.workspace,
      allowedTools: envConfig.allowedTools,
      maxTurns: envConfig.max_turns,
      env: envConfig.env,
      resumeSessionId: sessionId,
    })

    runningProcesses.set(sessionId, abort)

    return streamSSE(c, async (stream) => {
      try {
        for await (const event of events) {
          // Skip session_created on resume — API contract says follow-up has no session_created
          if (event.type === 'session_created') continue

          if (event.type === 'text_delta') {
            await stream.writeSSE({
              event: 'text_delta',
              data: JSON.stringify({ text: event.text }),
            })
          } else if (event.type === 'tool_use') {
            await stream.writeSSE({
              event: 'tool_use',
              data: JSON.stringify({
                tool: event.tool,
                input: event.input,
              }),
            })
          } else if (event.type === 'result') {
            appendMessage(config.workspace_root, sessionId, {
              role: 'assistant',
              content: event.result,
              timestamp: new Date().toISOString(),
            })

            await stream.writeSSE({
              event: 'result',
              data: JSON.stringify({
                result: event.result,
                num_turns: event.num_turns,
                cost_usd: event.cost_usd,
              }),
            })
          } else if (event.type === 'error') {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                code: event.code,
                message: event.message,
              }),
            })
          }
        }
      } finally {
        runningCount--
        runningProcesses.delete(sessionId)
        const current = getSession(config.workspace_root, sessionId)
        if (current && current.status === 'running') {
          updateSessionStatus(config.workspace_root, sessionId, 'idle')
        }
      }
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
    runningProcesses.delete(sessionId)
    runningCount--
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

  return app
}

import { chromium } from 'playwright'
import { createConnection } from '@playwright/mcp'
import { StreamableHTTPTransport } from '@hono/mcp'
import type { Context } from 'hono'

// Use structural types to avoid cross-package type incompatibility
// between playwright@1.58 and @playwright/mcp's internal playwright-core@1.56
interface PlaywrightSession {
  browser: { close: () => Promise<void> }
  // Factory to create a new MCP server reusing the same BrowserContext.
  // Each `claude -p` invocation needs its own server+transport pair because
  // StreamableHTTPTransport only supports one initialization per instance.
  connectNewServer: () => Promise<StreamableHTTPTransport>
  transport: StreamableHTTPTransport | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

const sessions = new Map<string, PlaywrightSession>()
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

export async function handleMcpRequest(
  workspaceId: string,
  c: Context,
): Promise<Response | undefined> {
  let session = sessions.get(workspaceId)

  if (!session) {
    const browser = await chromium.launch({ headless: false })
    const context = await browser.newContext()

    const connectNewServer = async () => {
      // @ts-expect-error playwright@1.58 BrowserContext vs @playwright/mcp's playwright-core@1.56 BrowserContext
      const server = await createConnection({}, async () => context)
      const transport = new StreamableHTTPTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })
      await server.connect(transport)
      return transport
    }

    session = { browser, connectNewServer, transport: null, idleTimer: null }
    sessions.set(workspaceId, session)
  }

  // POST without mcp-session-id = new MCP initialization (new claude -p process).
  // Create a fresh server+transport to avoid "Server already initialized" error.
  const mcpSessionId = c.req.header('mcp-session-id')
  if (!mcpSessionId && c.req.method === 'POST') {
    session.transport = await session.connectNewServer()
  }

  if (!session.transport) {
    return undefined
  }

  return session.transport.handleRequest(c)
}

export function startIdleTimer(workspaceId: string): void {
  const session = sessions.get(workspaceId)
  if (!session) return

  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
  }

  session.idleTimer = setTimeout(() => {
    void destroySession(workspaceId)
  }, IDLE_TIMEOUT_MS)
}

export function cancelIdleTimer(workspaceId: string): void {
  const session = sessions.get(workspaceId)
  if (!session?.idleTimer) return

  clearTimeout(session.idleTimer)
  session.idleTimer = null
}

export async function destroySession(workspaceId: string): Promise<void> {
  const session = sessions.get(workspaceId)
  if (!session) return

  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
  }

  // Close browser directly instead of server.close()
  // to avoid the MCP server's close handler double-closing the BrowserContext
  await session.browser.close()
  sessions.delete(workspaceId)
}

export async function destroyAll(): Promise<void> {
  const ids = [...sessions.keys()]
  await Promise.all(ids.map((id) => destroySession(id)))
}

export function getActiveCount(): number {
  return sessions.size
}

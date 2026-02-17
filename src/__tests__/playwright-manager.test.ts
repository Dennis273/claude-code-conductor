import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('playwright', () => ({
  chromium: {
    launchPersistentContext: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@playwright/mcp', () => ({
  createConnection: vi.fn().mockResolvedValue({
    connect: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@hono/mcp', () => ({
  StreamableHTTPTransport: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.handleRequest = vi.fn().mockResolvedValue(new Response('ok'))
  }),
}))

import { chromium } from 'playwright'
import { createConnection } from '@playwright/mcp'
import { StreamableHTTPTransport } from '@hono/mcp'
import { createPlaywrightManager } from '../core/playwright-manager.js'

type Manager = ReturnType<typeof createPlaywrightManager>
type McpContext = Parameters<Manager['handleMcpRequest']>[1]

function createMockContext(opts: { method?: string; mcpSessionId?: string } = {}): McpContext {
  return {
    req: {
      method: opts.method ?? 'POST',
      header: (name: string) => {
        if (name === 'mcp-session-id') return opts.mcpSessionId
        return undefined
      },
    },
  } as unknown as McpContext
}

describe('playwright-manager', () => {
  let manager: Manager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    manager = createPlaywrightManager('/test/workspaces')

    vi.mocked(chromium.launchPersistentContext).mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
    } as never)
  })

  afterEach(async () => {
    await manager.destroyAll()
    vi.useRealTimers()
  })

  describe('handleMcpRequest', () => {
    it('lazily creates persistent browser context on first request', async () => {
      expect(manager.getActiveCount()).toBe(0)

      const ctx = createMockContext()
      await manager.handleMcpRequest('ws-1', ctx)

      expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
        '/test/workspaces/ws-1/browser_data',
        { headless: false },
      )
      expect(createConnection).toHaveBeenCalled()
      expect(StreamableHTTPTransport).toHaveBeenCalled()
      expect(manager.getActiveCount()).toBe(1)
    })

    it('reuses transport for requests with mcp-session-id header', async () => {
      const initCtx = createMockContext()
      await manager.handleMcpRequest('ws-1', initCtx)

      const followUpCtx = createMockContext({ mcpSessionId: 'some-session-id' })
      await manager.handleMcpRequest('ws-1', followUpCtx)

      expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1)
      expect(createConnection).toHaveBeenCalledTimes(1)
      expect(manager.getActiveCount()).toBe(1)
    })

    it('creates new server+transport on re-initialization without mcp-session-id', async () => {
      const ctx1 = createMockContext()
      await manager.handleMcpRequest('ws-1', ctx1)

      expect(createConnection).toHaveBeenCalledTimes(1)

      // Second claude -p process sends initialize (no mcp-session-id)
      const ctx2 = createMockContext()
      await manager.handleMcpRequest('ws-1', ctx2)

      // Browser reused, but server + transport recreated
      expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1)
      expect(createConnection).toHaveBeenCalledTimes(2)
      expect(manager.getActiveCount()).toBe(1)
    })

    it('creates separate sessions for different workspaces', async () => {
      const ctx = createMockContext()

      await manager.handleMcpRequest('ws-1', ctx)
      await manager.handleMcpRequest('ws-2', ctx)

      expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2)
      expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
        '/test/workspaces/ws-1/browser_data',
        { headless: false },
      )
      expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
        '/test/workspaces/ws-2/browser_data',
        { headless: false },
      )
      expect(manager.getActiveCount()).toBe(2)
    })

    it('delegates to transport.handleRequest', async () => {
      const ctx = createMockContext()

      const response = await manager.handleMcpRequest('ws-1', ctx)

      expect(response).toBeInstanceOf(Response)
    })
  })

  describe('idle timer', () => {
    it('destroys session after timeout', async () => {
      const mockContext = createMockContext()
      await manager.handleMcpRequest('ws-1', mockContext)

      manager.startIdleTimer('ws-1')
      expect(manager.getActiveCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(manager.getActiveCount()).toBe(0)
    })

    it('does not destroy before timeout', async () => {
      const mockContext = createMockContext()
      await manager.handleMcpRequest('ws-1', mockContext)

      manager.startIdleTimer('ws-1')

      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

      expect(manager.getActiveCount()).toBe(1)
    })

    it('cancelIdleTimer prevents destruction', async () => {
      const mockContext = createMockContext()
      await manager.handleMcpRequest('ws-1', mockContext)

      manager.startIdleTimer('ws-1')
      manager.cancelIdleTimer('ws-1')

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(manager.getActiveCount()).toBe(1)
    })

    it('startIdleTimer resets existing timer', async () => {
      const mockContext = createMockContext()
      await manager.handleMcpRequest('ws-1', mockContext)

      manager.startIdleTimer('ws-1')
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

      // Reset timer — needs another 5 minutes from this point
      manager.startIdleTimer('ws-1')
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

      expect(manager.getActiveCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      expect(manager.getActiveCount()).toBe(0)
    })

    it('startIdleTimer does nothing for nonexistent session', () => {
      manager.startIdleTimer('nonexistent')
      // should not throw
    })

    it('cancelIdleTimer does nothing for nonexistent session', () => {
      manager.cancelIdleTimer('nonexistent')
      // should not throw
    })
  })

  describe('destroySession', () => {
    it('closes persistent context and removes from map', async () => {
      const mockContext = createMockContext()
      await manager.handleMcpRequest('ws-1', mockContext)

      const context = await vi.mocked(chromium.launchPersistentContext).mock.results[0].value
      await manager.destroySession('ws-1')

      expect(context.close).toHaveBeenCalled()
      expect(manager.getActiveCount()).toBe(0)
    })

    it('does nothing for nonexistent session', async () => {
      await manager.destroySession('nonexistent')
      // should not throw
    })

    it('clears idle timer on destroy', async () => {
      const mockContext = createMockContext()
      await manager.handleMcpRequest('ws-1', mockContext)

      manager.startIdleTimer('ws-1')
      await manager.destroySession('ws-1')

      // Timer callback should not error after session is destroyed
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(manager.getActiveCount()).toBe(0)
    })
  })

  describe('destroyAll', () => {
    it('destroys all active sessions', async () => {
      const mockContext = createMockContext()
      await manager.handleMcpRequest('ws-1', mockContext)
      await manager.handleMcpRequest('ws-2', mockContext)

      expect(manager.getActiveCount()).toBe(2)

      await manager.destroyAll()

      expect(manager.getActiveCount()).toBe(0)
    })

    it('handles empty sessions map', async () => {
      await manager.destroyAll()
      expect(manager.getActiveCount()).toBe(0)
    })
  })
})

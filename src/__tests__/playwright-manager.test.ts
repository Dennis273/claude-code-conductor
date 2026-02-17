import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      newContext: vi.fn().mockResolvedValue({}),
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
import {
  handleMcpRequest,
  startIdleTimer,
  cancelIdleTimer,
  destroySession,
  destroyAll,
  getActiveCount,
} from '../core/playwright-manager.js'

type McpContext = Parameters<typeof handleMcpRequest>[1]

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
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    // Reset mocks to return fresh objects per test
    vi.mocked(chromium.launch).mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      newContext: vi.fn().mockResolvedValue({}),
    } as never)
  })

  afterEach(async () => {
    await destroyAll()
    vi.useRealTimers()
  })

  describe('handleMcpRequest', () => {
    it('lazily creates browser on first request', async () => {
      expect(getActiveCount()).toBe(0)

      const ctx = createMockContext()
      await handleMcpRequest('ws-1', ctx)

      expect(chromium.launch).toHaveBeenCalledWith({ headless: false })
      expect(createConnection).toHaveBeenCalled()
      expect(StreamableHTTPTransport).toHaveBeenCalled()
      expect(getActiveCount()).toBe(1)
    })

    it('reuses transport for requests with mcp-session-id header', async () => {
      const initCtx = createMockContext()
      await handleMcpRequest('ws-1', initCtx)

      const followUpCtx = createMockContext({ mcpSessionId: 'some-session-id' })
      await handleMcpRequest('ws-1', followUpCtx)

      expect(chromium.launch).toHaveBeenCalledTimes(1)
      expect(createConnection).toHaveBeenCalledTimes(1)
      expect(getActiveCount()).toBe(1)
    })

    it('creates new server+transport on re-initialization without mcp-session-id', async () => {
      const ctx1 = createMockContext()
      await handleMcpRequest('ws-1', ctx1)

      expect(createConnection).toHaveBeenCalledTimes(1)

      // Second claude -p process sends initialize (no mcp-session-id)
      const ctx2 = createMockContext()
      await handleMcpRequest('ws-1', ctx2)

      // Browser reused, but server + transport recreated
      expect(chromium.launch).toHaveBeenCalledTimes(1)
      expect(createConnection).toHaveBeenCalledTimes(2)
      expect(getActiveCount()).toBe(1)
    })

    it('creates separate sessions for different workspaces', async () => {
      const ctx = createMockContext()

      await handleMcpRequest('ws-1', ctx)
      await handleMcpRequest('ws-2', ctx)

      expect(chromium.launch).toHaveBeenCalledTimes(2)
      expect(chromium.launch).toHaveBeenCalledWith({ headless: false })
      expect(getActiveCount()).toBe(2)
    })

    it('delegates to transport.handleRequest', async () => {
      const ctx = createMockContext()

      const response = await handleMcpRequest('ws-1', ctx)

      expect(response).toBeInstanceOf(Response)
    })
  })

  describe('idle timer', () => {
    it('destroys session after timeout', async () => {
      const mockContext = createMockContext()
      await handleMcpRequest('ws-1', mockContext)

      startIdleTimer('ws-1')
      expect(getActiveCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(getActiveCount()).toBe(0)
    })

    it('does not destroy before timeout', async () => {
      const mockContext = createMockContext()
      await handleMcpRequest('ws-1', mockContext)

      startIdleTimer('ws-1')

      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

      expect(getActiveCount()).toBe(1)
    })

    it('cancelIdleTimer prevents destruction', async () => {
      const mockContext = createMockContext()
      await handleMcpRequest('ws-1', mockContext)

      startIdleTimer('ws-1')
      cancelIdleTimer('ws-1')

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(getActiveCount()).toBe(1)
    })

    it('startIdleTimer resets existing timer', async () => {
      const mockContext = createMockContext()
      await handleMcpRequest('ws-1', mockContext)

      startIdleTimer('ws-1')
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

      // Reset timer — needs another 5 minutes from this point
      startIdleTimer('ws-1')
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000)

      expect(getActiveCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)

      expect(getActiveCount()).toBe(0)
    })

    it('startIdleTimer does nothing for nonexistent session', () => {
      startIdleTimer('nonexistent')
      // should not throw
    })

    it('cancelIdleTimer does nothing for nonexistent session', () => {
      cancelIdleTimer('nonexistent')
      // should not throw
    })
  })

  describe('destroySession', () => {
    it('closes browser and removes from map', async () => {
      const mockContext = createMockContext()
      await handleMcpRequest('ws-1', mockContext)

      const browser = await vi.mocked(chromium.launch).mock.results[0].value
      await destroySession('ws-1')

      expect(browser.close).toHaveBeenCalled()
      expect(getActiveCount()).toBe(0)
    })

    it('does nothing for nonexistent session', async () => {
      await destroySession('nonexistent')
      // should not throw
    })

    it('clears idle timer on destroy', async () => {
      const mockContext = createMockContext()
      await handleMcpRequest('ws-1', mockContext)

      startIdleTimer('ws-1')
      await destroySession('ws-1')

      // Timer callback should not error after session is destroyed
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(getActiveCount()).toBe(0)
    })
  })

  describe('destroyAll', () => {
    it('destroys all active sessions', async () => {
      const mockContext = createMockContext()
      await handleMcpRequest('ws-1', mockContext)
      await handleMcpRequest('ws-2', mockContext)

      expect(getActiveCount()).toBe(2)

      await destroyAll()

      expect(getActiveCount()).toBe(0)
    })

    it('handles empty sessions map', async () => {
      await destroyAll()
      expect(getActiveCount()).toBe(0)
    })
  })
})

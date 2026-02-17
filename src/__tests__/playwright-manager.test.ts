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

      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)

      expect(chromium.launch).toHaveBeenCalledWith({ headless: false })
      expect(createConnection).toHaveBeenCalled()
      expect(StreamableHTTPTransport).toHaveBeenCalled()
      expect(getActiveCount()).toBe(1)
    })

    it('reuses existing session on subsequent requests', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]

      await handleMcpRequest('ws-1', mockContext, false)
      await handleMcpRequest('ws-1', mockContext, false)

      expect(chromium.launch).toHaveBeenCalledTimes(1)
      expect(getActiveCount()).toBe(1)
    })

    it('creates separate sessions for different workspaces', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]

      await handleMcpRequest('ws-1', mockContext, false)
      await handleMcpRequest('ws-2', mockContext, true)

      expect(chromium.launch).toHaveBeenCalledTimes(2)
      expect(chromium.launch).toHaveBeenCalledWith({ headless: false })
      expect(chromium.launch).toHaveBeenCalledWith({ headless: true })
      expect(getActiveCount()).toBe(2)
    })

    it('delegates to transport.handleRequest', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]

      const response = await handleMcpRequest('ws-1', mockContext, false)

      expect(response).toBeInstanceOf(Response)
    })
  })

  describe('idle timer', () => {
    it('destroys session after timeout', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)

      startIdleTimer('ws-1')
      expect(getActiveCount()).toBe(1)

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(getActiveCount()).toBe(0)
    })

    it('does not destroy before timeout', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)

      startIdleTimer('ws-1')

      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)

      expect(getActiveCount()).toBe(1)
    })

    it('cancelIdleTimer prevents destruction', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)

      startIdleTimer('ws-1')
      cancelIdleTimer('ws-1')

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(getActiveCount()).toBe(1)
    })

    it('startIdleTimer resets existing timer', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)

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
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)

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
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)

      startIdleTimer('ws-1')
      await destroySession('ws-1')

      // Timer callback should not error after session is destroyed
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

      expect(getActiveCount()).toBe(0)
    })
  })

  describe('destroyAll', () => {
    it('destroys all active sessions', async () => {
      const mockContext = {} as Parameters<typeof handleMcpRequest>[1]
      await handleMcpRequest('ws-1', mockContext, false)
      await handleMcpRequest('ws-2', mockContext, true)

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

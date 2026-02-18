import { describe, it, expect, vi } from 'vitest'

const { mockTransport } = vi.hoisted(() => {
  return { mockTransport: vi.fn().mockReturnValue({ on: vi.fn() }) }
})

vi.mock('pino', () => {
  const pinoFn = vi.fn((...args: unknown[]) => {
    return {
      level: typeof args[0] === 'object' && args[0] !== null ? (args[0] as Record<string, unknown>).level ?? 'info' : 'info',
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }
  })
  const mockPino = Object.assign(pinoFn, { transport: mockTransport })

  return { default: mockPino, pino: mockPino }
})

import pino from 'pino'
import { createLogger } from '../core/logger.js'

describe('createLogger', () => {
  it('returns a pino logger with level info when no config is provided', () => {
    const logger = createLogger()

    expect(pino).toHaveBeenCalledWith({ level: 'info' })
    expect(logger.level).toBe('info')
  })

  it('creates multi-transport (stdout + file) when log config is provided', () => {
    const logConfig = {
      file: '/var/log/conductor/app',
      level: 'debug',
      size: '20m',
      max_files: 10,
    }

    createLogger(logConfig)

    expect(mockTransport).toHaveBeenCalledWith({
      targets: [
        {
          target: 'pino/file',
          options: { destination: 1 },
          level: 'debug',
        },
        {
          target: 'pino-roll',
          options: {
            file: '/var/log/conductor/app',
            size: '20m',
            limit: { count: 10 },
            mkdir: true,
          },
          level: 'debug',
        },
      ],
    })

    expect(pino).toHaveBeenCalledWith(
      { level: 'debug' },
      expect.anything(),
    )
  })

  it('uses config level for pino instance', () => {
    const logConfig = {
      file: '/tmp/app',
      level: 'warn',
      size: '10m',
      max_files: 5,
    }

    const logger = createLogger(logConfig)
    expect(logger.level).toBe('warn')
  })
})

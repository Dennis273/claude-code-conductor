import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn() }
})

import { spawn } from 'node:child_process'
import { generateTitle } from '../core/title.js'

function mockSpawn(jsonOutput: string, exitCode = 0) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    stdin: null,
    kill: vi.fn(),
    pid: 1234,
  })

  vi.mocked(spawn).mockReturnValue(child as never)

  // Emit data + close asynchronously so the caller can attach listeners first
  process.nextTick(() => {
    stdout.end(jsonOutput)
    child.emit('close', exitCode)
  })
}

describe('generateTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cleaned title from claude output', async () => {
    mockSpawn(JSON.stringify({ result: '斐波那契 Python 函数' }))

    const title = await generateTitle('帮我写一个 Python 函数来计算斐波那契数列')

    expect(title).toBe('斐波那契 Python 函数')
    expect(vi.mocked(spawn)).toHaveBeenCalledOnce()

    const args = vi.mocked(spawn).mock.calls[0]
    expect(args[0]).toBe('claude')
    expect(args[1]).toContain('--model')
    expect(args[1]).toContain('haiku')
  })

  it('strips surrounding quotes from title', async () => {
    mockSpawn(JSON.stringify({ result: '"Some Title"' }))

    const title = await generateTitle('test prompt')
    expect(title).toBe('Some Title')
  })

  it('truncates title to 30 characters', async () => {
    mockSpawn(JSON.stringify({ result: 'A'.repeat(50) }))

    const title = await generateTitle('test prompt')
    expect(title).toHaveLength(30)
  })

  it('returns null when prompt is empty', async () => {
    const title = await generateTitle('')
    expect(title).toBeNull()
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  })

  it('returns null when prompt is whitespace only', async () => {
    const title = await generateTitle('   ')
    expect(title).toBeNull()
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  })

  it('returns null when claude returns empty result', async () => {
    mockSpawn(JSON.stringify({ result: '' }))

    const title = await generateTitle('test prompt')
    expect(title).toBeNull()
  })

  it('returns null when claude returns invalid JSON', async () => {
    mockSpawn('not json at all')

    const title = await generateTitle('test prompt')
    expect(title).toBeNull()
  })

  it('returns null when claude returns no result field', async () => {
    mockSpawn(JSON.stringify({ error: 'something' }))

    const title = await generateTitle('test prompt')
    expect(title).toBeNull()
  })
})

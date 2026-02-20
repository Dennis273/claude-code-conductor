import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}))

import { query } from '@anthropic-ai/claude-agent-sdk'
import { generateTitle } from '../core/title.js'

function mockQuery(resultText: string | null, isError = false) {
  const messages = isError
    ? [{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['fail'], session_id: 'x', num_turns: 0, total_cost_usd: 0 }]
    : [{ type: 'result', subtype: 'success', is_error: false, result: resultText ?? '', session_id: 'x', num_turns: 1, total_cost_usd: 0 }]

  async function* fakeGenerator() {
    for (const msg of messages) {
      yield msg
    }
  }

  vi.mocked(query).mockReturnValue(fakeGenerator() as ReturnType<typeof query>)
}

describe('generateTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cleaned title from SDK result', async () => {
    mockQuery('斐波那契 Python 函数')

    const title = await generateTitle('帮我写一个 Python 函数来计算斐波那契数列')

    expect(title).toBe('斐波那契 Python 函数')
    expect(vi.mocked(query)).toHaveBeenCalledOnce()

    const callArgs = vi.mocked(query).mock.calls[0][0]
    expect(callArgs.options?.model).toBe('haiku')
    expect(callArgs.options?.maxTurns).toBe(1)
    expect(callArgs.options?.allowedTools).toEqual([])
  })

  it('strips surrounding quotes from title', async () => {
    mockQuery('"Some Title"')

    const title = await generateTitle('test prompt')
    expect(title).toBe('Some Title')
  })

  it('truncates title to 30 characters', async () => {
    mockQuery('A'.repeat(50))

    const title = await generateTitle('test prompt')
    expect(title).toHaveLength(30)
  })

  it('returns null when prompt is empty', async () => {
    const title = await generateTitle('')
    expect(title).toBeNull()
    expect(vi.mocked(query)).not.toHaveBeenCalled()
  })

  it('returns null when prompt is whitespace only', async () => {
    const title = await generateTitle('   ')
    expect(title).toBeNull()
    expect(vi.mocked(query)).not.toHaveBeenCalled()
  })

  it('returns null when SDK returns empty result', async () => {
    mockQuery('')

    const title = await generateTitle('test prompt')
    expect(title).toBeNull()
  })

  it('returns null when SDK returns error result', async () => {
    mockQuery(null, true)

    const title = await generateTitle('test prompt')
    expect(title).toBeNull()
  })

  it('returns null when query throws', async () => {
    vi.mocked(query).mockImplementation(() => {
      throw new Error('connection failed')
    })

    const title = await generateTitle('test prompt')
    expect(title).toBeNull()
  })
})

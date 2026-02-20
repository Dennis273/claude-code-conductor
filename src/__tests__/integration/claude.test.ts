import { describe, it, expect } from 'vitest'
import { executePrompt } from '../../core/claude.js'
import type { ConductorEvent } from '../../types.js'

describe('executePrompt', () => {
  it('yields session_created, text_delta, and result events', async () => {
    const events: ConductorEvent[] = []

    const handle = executePrompt({
      prompt: '说"hello"这一个词，不要说别的',
      cwd: '/tmp',
      allowedTools: ['Read'],
      maxTurns: 1,
      env: {},
    })

    for await (const event of handle.events) {
      events.push(event)
    }

    const types = events.map((e) => e.type)

    expect(types).toContain('session_created')
    expect(types).toContain('result')

    const sessionCreated = events.find((e) => e.type === 'session_created')
    expect(sessionCreated).toBeDefined()
    if (sessionCreated?.type === 'session_created') {
      expect(sessionCreated.session_id).toBeTruthy()
    }

    const result = events.find((e) => e.type === 'result')
    expect(result).toBeDefined()
    if (result?.type === 'result') {
      expect(result.session_id).toBeTruthy()
      expect(typeof result.num_turns).toBe('number')
      expect(typeof result.cost_usd).toBe('number')
    }

    const hasTextDelta = types.includes('text_delta')
    expect(hasTextDelta).toBe(true)
  }, 30000)

  it('yields tool_use events with non-empty input and matching tool_result', async () => {
    const events: ConductorEvent[] = []

    const handle = executePrompt({
      prompt: '用 Bash 执行 echo hello',
      cwd: '/tmp',
      allowedTools: ['Bash'],
      maxTurns: 3,
      env: {},
    })

    for await (const event of handle.events) {
      events.push(event)
    }

    const toolUseEvents = events.filter((e) => e.type === 'tool_use')
    expect(toolUseEvents.length).toBeGreaterThan(0)

    // tool_use must have id and non-empty input
    for (const event of toolUseEvents) {
      if (event.type === 'tool_use') {
        expect(event.id).toBeTruthy()
        expect(event.id).toMatch(/^toolu_/)
        expect(Object.keys(event.input).length).toBeGreaterThan(0)
      }
    }

    // Each tool_use must have a matching tool_result with tool_use_id
    const toolResultEvents = events.filter((e) => e.type === 'tool_result')
    expect(toolResultEvents.length).toBe(toolUseEvents.length)

    const toolUseIds = new Set(
      toolUseEvents.map((e) => (e.type === 'tool_use' ? e.id : ''))
    )
    for (const event of toolResultEvents) {
      if (event.type === 'tool_result') {
        expect(typeof event.content).toBe('string')
        expect(typeof event.is_error).toBe('boolean')
        expect(event.tool_use_id).toBeTruthy()
        expect(toolUseIds.has(event.tool_use_id)).toBe(true)
      }
    }
  }, 60000)

  it('supports --resume with session_id', async () => {
    // First call: create session
    let sessionId = ''
    const firstHandle = executePrompt({
      prompt: '记住数字42',
      cwd: '/tmp',
      allowedTools: ['Read'],
      maxTurns: 1,
      env: {},
    })
    for await (const event of firstHandle.events) {
      if (event.type === 'result') {
        sessionId = event.session_id
      }
    }

    expect(sessionId).toBeTruthy()

    // Second call: resume session
    let resultText = ''
    const secondHandle = executePrompt({
      prompt: '我刚才让你记住的数字是什么？只回答数字',
      cwd: '/tmp',
      allowedTools: ['Read'],
      maxTurns: 1,
      env: {},
      resumeSessionId: sessionId,
    })
    for await (const event of secondHandle.events) {
      if (event.type === 'result') {
        resultText = event.result
      }
    }

    expect(resultText).toContain('42')
  }, 30000)
})

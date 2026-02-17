import { describe, it, expect } from 'vitest'
import { formatSSEData } from '../api/sse-format.js'
import type { ConductorEvent } from '../types.js'

describe('formatSSEData', () => {
  it('formats session_created event', () => {
    const event: ConductorEvent = {
      type: 'session_created',
      session_id: 'abc-123',
      workspace: '/tmp/workspace',
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'session_created',
      data: JSON.stringify({ session_id: 'abc-123', workspace: '/tmp/workspace' }),
    })
  })

  it('formats text_delta event', () => {
    const event: ConductorEvent = {
      type: 'text_delta',
      text: 'hello world',
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'text_delta',
      data: JSON.stringify({ text: 'hello world' }),
    })
  })

  it('formats tool_use event', () => {
    const event: ConductorEvent = {
      type: 'tool_use',
      id: 'toolu_123',
      tool: 'Bash',
      input: { command: 'echo hello' },
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'tool_use',
      data: JSON.stringify({
        id: 'toolu_123',
        tool: 'Bash',
        input: { command: 'echo hello' },
      }),
    })
  })

  it('formats tool_result event', () => {
    const event: ConductorEvent = {
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      content: 'hello\n',
      is_error: false,
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'tool_result',
      data: JSON.stringify({
        tool_use_id: 'toolu_123',
        content: 'hello\n',
        is_error: false,
      }),
    })
  })

  it('formats result event with all fields', () => {
    const event: ConductorEvent = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Task complete',
      session_id: 'abc-123',
      num_turns: 3,
      cost_usd: 0.05,
      errors: [],
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'result',
      data: JSON.stringify({
        subtype: 'success',
        is_error: false,
        result: 'Task complete',
        num_turns: 3,
        cost_usd: 0.05,
        errors: [],
      }),
    })
  })

  it('formats result event with error fields', () => {
    const event: ConductorEvent = {
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      result: '',
      session_id: 'abc-123',
      num_turns: 5,
      cost_usd: 0.10,
      errors: ['Max turns reached'],
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'result',
      data: JSON.stringify({
        subtype: 'error_max_turns',
        is_error: true,
        result: '',
        num_turns: 5,
        cost_usd: 0.10,
        errors: ['Max turns reached'],
      }),
    })
  })

  it('formats raw_message event', () => {
    const event: ConductorEvent = {
      type: 'raw_message',
      message_type: 'assistant',
      raw: { type: 'assistant', message: { role: 'assistant' } },
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'raw_message',
      data: JSON.stringify({
        message_type: 'assistant',
        raw: { type: 'assistant', message: { role: 'assistant' } },
      }),
    })
  })

  it('formats error event', () => {
    const event: ConductorEvent = {
      type: 'error',
      code: 'PROCESS_ERROR',
      message: 'something went wrong',
    }
    const result = formatSSEData(event)
    expect(result).toEqual({
      event: 'error',
      data: JSON.stringify({
        code: 'PROCESS_ERROR',
        message: 'something went wrong',
      }),
    })
  })
})

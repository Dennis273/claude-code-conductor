import type { ConductorEvent } from '../types.js'

export function formatSSEData(event: ConductorEvent): {
  event: string
  data: string
} {
  switch (event.type) {
    case 'session_created':
      return {
        event: 'session_created',
        data: JSON.stringify({
          session_id: event.session_id,
          workspace: event.workspace,
        }),
      }
    case 'text_delta':
      return {
        event: 'text_delta',
        data: JSON.stringify({ text: event.text }),
      }
    case 'tool_use':
      return {
        event: 'tool_use',
        data: JSON.stringify({
          id: event.id,
          tool: event.tool,
          input: event.input,
        }),
      }
    case 'tool_result':
      return {
        event: 'tool_result',
        data: JSON.stringify({
          tool_use_id: event.tool_use_id,
          content: event.content,
          is_error: event.is_error,
        }),
      }
    case 'result':
      return {
        event: 'result',
        data: JSON.stringify({
          subtype: event.subtype,
          is_error: event.is_error,
          result: event.result,
          num_turns: event.num_turns,
          cost_usd: event.cost_usd,
          errors: event.errors,
        }),
      }
    case 'raw_message':
      return {
        event: 'raw_message',
        data: JSON.stringify({
          message_type: event.message_type,
          raw: event.raw,
        }),
      }
    case 'error':
      return {
        event: 'error',
        data: JSON.stringify({
          code: event.code,
          message: event.message,
        }),
      }
  }
}

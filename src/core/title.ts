import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * Generate a short title (2-5 words) for a session prompt using Claude Haiku.
 * Returns null if generation fails or prompt is empty.
 */
export async function generateTitle(prompt: string): Promise<string | null> {
  if (!prompt.trim()) return null

  const systemPrompt =
    'Generate a 2-5 word title that captures the core topic of the user message. Reply with ONLY the title text, nothing else. No quotes, no punctuation, no explanation.'

  try {
    const result = await runClaude(systemPrompt, prompt)
    if (!result) return null

    // Clean up: remove quotes, trim, limit length
    const cleaned = result.replace(/^["']+|["']+$/g, '').trim()
    return cleaned.length > 0 ? cleaned.slice(0, 30) : null
  } catch {
    return null
  }
}

async function runClaude(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 15000)

  try {
    const q = query({
      prompt: userPrompt,
      options: {
        model: 'haiku',
        systemPrompt,
        maxTurns: 1,
        allowedTools: [],
        abortController,
        env: { ...process.env, CLAUDECODE: '' },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        persistSession: false,
      },
    })

    for await (const msg of q) {
      if (msg.type === 'result') {
        const result = msg as SDKResultMessage
        if (!result.is_error && 'result' in result) {
          return (result as SDKResultMessage & { result?: string }).result?.trim() ?? null
        }
        return null
      }
    }

    return null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

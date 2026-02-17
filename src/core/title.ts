import { spawn } from 'node:child_process'
import { z } from 'zod'

const TitleResponse = z.object({
  result: z.string().optional(),
})

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

function runClaude(systemPrompt: string, userPrompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      'claude',
      [
        '-p',
        userPrompt,
        '--system-prompt',
        systemPrompt,
        '--output-format',
        'json',
        '--model',
        'haiku',
        '--max-turns',
        '1',
        '--allowedTools',
        '',
        '--no-session-persistence',
      ],
      {
        env: { ...process.env, CLAUDECODE: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      resolve(null)
    }, 15000)

    child.on('close', () => {
      clearTimeout(timeout)
      try {
        const parseResult = TitleResponse.safeParse(JSON.parse(stdout))
        resolve(parseResult.success ? (parseResult.data.result?.trim() ?? null) : null)
      } catch {
        resolve(null)
      }
    })
  })
}

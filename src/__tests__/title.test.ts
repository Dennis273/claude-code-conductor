import { describe, it, expect } from 'vitest'
import { generateTitle } from '../core/title.js'

describe('generateTitle', () => {
  it('generates a short title from a prompt', async () => {
    const title = await generateTitle('帮我写一个 Python 函数来计算斐波那契数列')

    expect(title).toBeTruthy()
    expect(typeof title).toBe('string')
    // Title should be concise (under 30 chars)
    expect(title!.length).toBeLessThanOrEqual(30)
    // Title should not be empty
    expect(title!.trim().length).toBeGreaterThan(0)
  }, 30000)

  it('returns null when prompt is empty', async () => {
    const title = await generateTitle('')
    expect(title).toBeNull()
  })
})

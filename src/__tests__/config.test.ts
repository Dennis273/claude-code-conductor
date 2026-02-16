import { describe, it, expect } from 'vitest'
import { loadConfig } from '../config.js'

describe('loadConfig', () => {
  it('loads conductor.yaml from project root', () => {
    const config = loadConfig()

    expect(config.port).toBe(4577)
    expect(config.concurrency).toBe(3)
    expect(config.workspace_root).toBe('/Users/dennis/.conductor/workspaces')
    expect(Object.keys(config.envs)).toEqual(['full', 'readonly'])
  })

  it('parses env config correctly', () => {
    const config = loadConfig()

    expect(config.envs.full.allowedTools).toContain('Bash')
    expect(config.envs.full.max_turns).toBe(20)
    expect(config.envs.full.env).toEqual({})

    expect(config.envs.readonly.allowedTools).toContain('Read')
    expect(config.envs.readonly.allowedTools).not.toContain('Bash')
    expect(config.envs.readonly.max_turns).toBe(5)
  })
})

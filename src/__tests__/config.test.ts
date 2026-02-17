import { describe, it, expect } from 'vitest'
import { loadConfig, validate } from '../config.js'

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
    expect(config.envs.full.playwright).toEqual({ headless: false })

    expect(config.envs.readonly.allowedTools).toContain('Read')
    expect(config.envs.readonly.allowedTools).not.toContain('Bash')
    expect(config.envs.readonly.max_turns).toBe(5)
    expect(config.envs.readonly.playwright).toBeUndefined()
  })
})

describe('validate mcpServers', () => {
  const baseConfig = {
    port: 4577,
    concurrency: 3,
    workspace_root: '/tmp/test',
    envs: {
      full: {
        allowedTools: 'Bash,Read',
        max_turns: 20,
        env: {},
      },
    },
  }

  it('mcpServers is optional — env without it parses fine', () => {
    const config = validate(baseConfig)
    expect(config.envs.full.mcpServers).toBeUndefined()
  })

  it('parses mcpServers with command and args', () => {
    const config = validate({
      ...baseConfig,
      envs: {
        browser: {
          allowedTools: 'Bash,Read',
          max_turns: 10,
          env: {},
          mcpServers: {
            playwright: {
              command: 'npx',
              args: ['@playwright/mcp@latest', '--browser', 'chrome'],
            },
          },
        },
      },
    })

    expect(config.envs.browser.mcpServers).toEqual({
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest', '--browser', 'chrome'],
      },
    })
  })

  it('parses mcpServers with optional env field', () => {
    const config = validate({
      ...baseConfig,
      envs: {
        browser: {
          allowedTools: 'Bash,Read',
          max_turns: 10,
          env: {},
          mcpServers: {
            playwright: {
              command: 'npx',
              args: ['@playwright/mcp@latest'],
              env: { DISPLAY: ':0' },
            },
          },
        },
      },
    })

    expect(config.envs.browser.mcpServers?.playwright.env).toEqual({ DISPLAY: ':0' })
  })

  it('rejects mcpServers that is not an object', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            mcpServers: 'not-an-object',
          },
        },
      }),
    ).toThrow('"bad.mcpServers" must be an object')
  })

  it('rejects server without command', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            mcpServers: {
              playwright: { args: ['--browser', 'chrome'] },
            },
          },
        },
      }),
    ).toThrow('"bad.mcpServers.playwright.command" must be a non-empty string')
  })

  it('rejects server with empty command', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            mcpServers: {
              playwright: { command: '', args: [] },
            },
          },
        },
      }),
    ).toThrow('"bad.mcpServers.playwright.command" must be a non-empty string')
  })

  it('rejects server without args', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            mcpServers: {
              playwright: { command: 'npx' },
            },
          },
        },
      }),
    ).toThrow('"bad.mcpServers.playwright.args" must be an array of strings')
  })

  it('rejects server with non-string args element', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            mcpServers: {
              playwright: { command: 'npx', args: [123] },
            },
          },
        },
      }),
    ).toThrow('"bad.mcpServers.playwright.args" must be an array of strings')
  })

  it('rejects server with non-object env', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            mcpServers: {
              playwright: { command: 'npx', args: [], env: 'bad' },
            },
          },
        },
      }),
    ).toThrow('"bad.mcpServers.playwright.env" must be an object')
  })

  it('rejects server with non-string env value', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            mcpServers: {
              playwright: { command: 'npx', args: [], env: { PORT: 8080 } },
            },
          },
        },
      }),
    ).toThrow('"bad.mcpServers.playwright.env.PORT" must be a string')
  })

  it('supports multiple MCP servers in one env', () => {
    const config = validate({
      ...baseConfig,
      envs: {
        multi: {
          allowedTools: 'Bash',
          max_turns: 10,
          env: {},
          mcpServers: {
            playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
            other: { command: 'node', args: ['server.js'] },
          },
        },
      },
    })

    expect(Object.keys(config.envs.multi.mcpServers!)).toEqual(['playwright', 'other'])
  })
})

describe('validate playwright', () => {
  const baseConfig = {
    port: 4577,
    concurrency: 3,
    workspace_root: '/tmp/test',
    envs: {
      full: {
        allowedTools: 'Bash,Read',
        max_turns: 20,
        env: {},
      },
    },
  }

  it('playwright is optional — env without it parses fine', () => {
    const config = validate(baseConfig)
    expect(config.envs.full.playwright).toBeUndefined()
  })

  it('parses playwright with headless: false', () => {
    const config = validate({
      ...baseConfig,
      envs: {
        browser: {
          allowedTools: 'Bash,Read',
          max_turns: 10,
          env: {},
          playwright: { headless: false },
        },
      },
    })

    expect(config.envs.browser.playwright).toEqual({ headless: false })
  })

  it('parses playwright with headless: true', () => {
    const config = validate({
      ...baseConfig,
      envs: {
        browser: {
          allowedTools: 'Bash,Read',
          max_turns: 10,
          env: {},
          playwright: { headless: true },
        },
      },
    })

    expect(config.envs.browser.playwright).toEqual({ headless: true })
  })

  it('rejects playwright that is not an object', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            playwright: 'not-an-object',
          },
        },
      }),
    ).toThrow('"bad.playwright" must be an object')
  })

  it('rejects playwright without headless', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            playwright: {},
          },
        },
      }),
    ).toThrow('"bad.playwright.headless" must be a boolean')
  })

  it('rejects playwright with non-boolean headless', () => {
    expect(() =>
      validate({
        ...baseConfig,
        envs: {
          bad: {
            allowedTools: 'Bash',
            max_turns: 10,
            env: {},
            playwright: { headless: 'yes' },
          },
        },
      }),
    ).toThrow('"bad.playwright.headless" must be a boolean')
  })

  it('playwright and mcpServers can coexist', () => {
    const config = validate({
      ...baseConfig,
      envs: {
        browser: {
          allowedTools: 'Bash,Read',
          max_turns: 10,
          env: {},
          playwright: { headless: false },
          mcpServers: {
            other: { command: 'node', args: ['server.js'] },
          },
        },
      },
    })

    expect(config.envs.browser.playwright).toEqual({ headless: false })
    expect(config.envs.browser.mcpServers).toBeDefined()
  })
})

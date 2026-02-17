import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import {
  createWorkspace,
  saveSession,
  getSession,
  updateSessionStatus,
  updateRunMessageOffset,
  listSessions,
  appendContentBlock,
  getMessages,
  writeMcpConfig,
} from '../core/session.js'

const TEST_ROOT = '/tmp/conductor-test-sessions'

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('createWorkspace', () => {
  it('creates an empty directory when no repo is given', () => {
    const { workspacePath } = createWorkspace(TEST_ROOT)
    expect(existsSync(workspacePath)).toBe(true)
  })

  it('clones a repo when repo is given', () => {
    const repoPath = '/tmp/conductor-test-repo'
    rmSync(repoPath, { recursive: true, force: true })
    mkdirSync(repoPath, { recursive: true })

    execSync('git init && git commit --allow-empty -m "init"', {
      cwd: repoPath,
      stdio: 'pipe',
    })

    const { workspacePath } = createWorkspace(TEST_ROOT, repoPath)
    expect(existsSync(workspacePath)).toBe(true)
    expect(existsSync(`${workspacePath}/.git`)).toBe(true)

    rmSync(repoPath, { recursive: true, force: true })
  })

  it('throws when clone fails', () => {
    expect(() => createWorkspace(TEST_ROOT, '/nonexistent/repo')).toThrow(
      'git clone failed',
    )
  })
})

describe('session persistence', () => {
  it('saves and retrieves session metadata', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    const metadata = {
      workspace: '/tmp/conductor-test-sessions/abc',
      env: 'full',
      repo: null,
      branch: null,
      status: 'idle' as const,
      title: 'Test session',
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
      run_message_offset: null,
    }

    saveSession(TEST_ROOT, 'session-1', metadata)

    const retrieved = getSession(TEST_ROOT, 'session-1')
    expect(retrieved).toEqual(metadata)
  })

  it('returns null for unknown session', () => {
    mkdirSync(TEST_ROOT, { recursive: true })
    const retrieved = getSession(TEST_ROOT, 'nonexistent')
    expect(retrieved).toBeNull()
  })

  it('updates session status', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    saveSession(TEST_ROOT, 'session-1', {
      workspace: '/tmp/test',
      env: 'full',
      repo: null,
      branch: null,
      status: 'idle',
      title: 'Test',
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
      run_message_offset: null,
    })

    updateSessionStatus(TEST_ROOT, 'session-1', 'running')

    const retrieved = getSession(TEST_ROOT, 'session-1')
    expect(retrieved?.status).toBe('running')
  })

  it('lists all sessions', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    saveSession(TEST_ROOT, 'session-1', {
      workspace: '/tmp/a',
      env: 'full',
      repo: null,
      branch: null,
      status: 'idle',
      title: 'Session A',
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
      run_message_offset: null,
    })

    saveSession(TEST_ROOT, 'session-2', {
      workspace: '/tmp/b',
      env: 'readonly',
      repo: '/path/to/repo',
      branch: 'main',
      status: 'running',
      title: 'Session B',
      created_at: '2026-02-16T01:00:00.000Z',
      last_active_at: '2026-02-16T01:00:00.000Z',
      run_message_offset: null,
    })

    const sessions = listSessions(TEST_ROOT)
    expect(Object.keys(sessions)).toHaveLength(2)
    expect(sessions['session-1'].env).toBe('full')
    expect(sessions['session-2'].env).toBe('readonly')
  })
})

describe('run_message_offset', () => {
  it('defaults to null for sessions saved without offset', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    saveSession(TEST_ROOT, 'session-1', {
      workspace: '/tmp/test',
      env: 'full',
      repo: null,
      branch: null,
      status: 'idle',
      title: 'Test',
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
      run_message_offset: null,
    })

    const retrieved = getSession(TEST_ROOT, 'session-1')
    expect(retrieved?.run_message_offset).toBeNull()
  })

  it('saves and retrieves offset when provided', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    saveSession(TEST_ROOT, 'session-1', {
      workspace: '/tmp/test',
      env: 'full',
      repo: null,
      branch: null,
      status: 'running',
      title: 'Test',
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
      run_message_offset: 3,
    })

    const retrieved = getSession(TEST_ROOT, 'session-1')
    expect(retrieved?.run_message_offset).toBe(3)
  })

  it('updateRunMessageOffset sets offset and can be read back', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    saveSession(TEST_ROOT, 'session-1', {
      workspace: '/tmp/test',
      env: 'full',
      repo: null,
      branch: null,
      status: 'running',
      title: 'Test',
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
      run_message_offset: null,
    })

    updateRunMessageOffset(TEST_ROOT, 'session-1', 5)

    const retrieved = getSession(TEST_ROOT, 'session-1')
    expect(retrieved?.run_message_offset).toBe(5)
  })

  it('updateRunMessageOffset does nothing for nonexistent session', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    // Should not throw
    updateRunMessageOffset(TEST_ROOT, 'nonexistent', 5)

    const retrieved = getSession(TEST_ROOT, 'nonexistent')
    expect(retrieved).toBeNull()
  })

  it('backward compatible: old data without run_message_offset defaults to null', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    // Simulate old data by writing JSON without run_message_offset
    const { writeFileSync } = require('node:fs')
    const { join } = require('node:path')
    const oldData = {
      'session-old': {
        workspace: '/tmp/test',
        env: 'full',
        repo: null,
        branch: null,
        status: 'idle',
        title: 'Old session',
        created_at: '2026-02-16T00:00:00.000Z',
        last_active_at: '2026-02-16T00:00:00.000Z',
      },
    }
    writeFileSync(
      join(TEST_ROOT, 'sessions.json'),
      JSON.stringify(oldData, null, 2),
      'utf-8',
    )

    const retrieved = getSession(TEST_ROOT, 'session-old')
    expect(retrieved).not.toBeNull()
    expect(retrieved?.run_message_offset).toBeNull()
  })
})

describe('writeMcpConfig', () => {
  it('writes .mcp.json with mcpServers content', () => {
    mkdirSync(TEST_ROOT, { recursive: true })
    const workspacePath = join(TEST_ROOT, 'ws1')
    mkdirSync(workspacePath, { recursive: true })

    writeMcpConfig(workspacePath, {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest', '--browser', 'chrome'],
      },
    })

    const mcpPath = join(workspacePath, '.mcp.json')
    expect(existsSync(mcpPath)).toBe(true)

    const content = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    expect(content).toEqual({
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['@playwright/mcp@latest', '--browser', 'chrome'],
        },
      },
    })
  })

  it('replaces {{workspace}} template variable in args', () => {
    mkdirSync(TEST_ROOT, { recursive: true })
    const workspacePath = join(TEST_ROOT, 'ws2')
    mkdirSync(workspacePath, { recursive: true })

    writeMcpConfig(workspacePath, {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest', '--user-data-dir', '{{workspace}}/.browser-profile'],
      },
    })

    const content = JSON.parse(readFileSync(join(workspacePath, '.mcp.json'), 'utf-8'))
    expect(content.mcpServers.playwright.args[2]).toBe(`${workspacePath}/.browser-profile`)
  })

  it('replaces {{workspace}} in env values', () => {
    mkdirSync(TEST_ROOT, { recursive: true })
    const workspacePath = join(TEST_ROOT, 'ws3')
    mkdirSync(workspacePath, { recursive: true })

    writeMcpConfig(workspacePath, {
      myserver: {
        command: 'node',
        args: ['server.js'],
        env: { DATA_DIR: '{{workspace}}/data' },
      },
    })

    const content = JSON.parse(readFileSync(join(workspacePath, '.mcp.json'), 'utf-8'))
    expect(content.mcpServers.myserver.env.DATA_DIR).toBe(`${workspacePath}/data`)
  })

  it('preserves server env in output', () => {
    mkdirSync(TEST_ROOT, { recursive: true })
    const workspacePath = join(TEST_ROOT, 'ws4')
    mkdirSync(workspacePath, { recursive: true })

    writeMcpConfig(workspacePath, {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        env: { DISPLAY: ':0' },
      },
    })

    const content = JSON.parse(readFileSync(join(workspacePath, '.mcp.json'), 'utf-8'))
    expect(content.mcpServers.playwright.env).toEqual({ DISPLAY: ':0' })
  })

  it('omits env key when server has no env', () => {
    mkdirSync(TEST_ROOT, { recursive: true })
    const workspacePath = join(TEST_ROOT, 'ws5')
    mkdirSync(workspacePath, { recursive: true })

    writeMcpConfig(workspacePath, {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest'],
      },
    })

    const content = JSON.parse(readFileSync(join(workspacePath, '.mcp.json'), 'utf-8'))
    expect(content.mcpServers.playwright).toEqual({
      command: 'npx',
      args: ['@playwright/mcp@latest'],
    })
    expect('env' in content.mcpServers.playwright).toBe(false)
  })
})

describe('message persistence with CC-compatible format', () => {
  it('stores user text as a Message with TextBlock', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    appendContentBlock(TEST_ROOT, 'session-1', 'user', {
      type: 'text',
      text: '用 Bash 执行 echo hello',
    })

    const messages = getMessages(TEST_ROOT, 'session-1')
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toHaveLength(1)
    expect(messages[0].content[0]).toEqual({
      type: 'text',
      text: '用 Bash 执行 echo hello',
    })
    expect(messages[0].timestamp).toBeTruthy()
  })

  it('appends blocks to last message when role matches', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    // Assistant sends text then uses a tool — same assistant message
    appendContentBlock(TEST_ROOT, 'session-1', 'assistant', {
      type: 'text',
      text: 'Let me run that',
    })
    appendContentBlock(TEST_ROOT, 'session-1', 'assistant', {
      type: 'tool_use',
      id: 'toolu_123',
      name: 'Bash',
      input: { command: 'echo hello' },
    })

    const messages = getMessages(TEST_ROOT, 'session-1')
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('assistant')
    expect(messages[0].content).toHaveLength(2)
    expect(messages[0].content[0]).toEqual({
      type: 'text',
      text: 'Let me run that',
    })
    expect(messages[0].content[1]).toEqual({
      type: 'tool_use',
      id: 'toolu_123',
      name: 'Bash',
      input: { command: 'echo hello' },
    })
  })

  it('creates new message when role changes', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    // Assistant message with tool_use
    appendContentBlock(TEST_ROOT, 'session-1', 'assistant', {
      type: 'tool_use',
      id: 'toolu_123',
      name: 'Bash',
      input: { command: 'echo hello' },
    })

    // User message with tool_result (different role → new message)
    appendContentBlock(TEST_ROOT, 'session-1', 'user', {
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      content: 'hello',
      is_error: false,
    })

    const messages = getMessages(TEST_ROOT, 'session-1')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('assistant')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content[0]).toEqual({
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      content: 'hello',
      is_error: false,
    })
  })

  it('handles full conversation with parallel tool calls', () => {
    mkdirSync(TEST_ROOT, { recursive: true })

    // User prompt
    appendContentBlock(TEST_ROOT, 'session-1', 'user', {
      type: 'text',
      text: 'Run two commands',
    })

    // Assistant: text + 2 tool_use (parallel)
    appendContentBlock(TEST_ROOT, 'session-1', 'assistant', {
      type: 'text',
      text: 'I will run both commands',
    })
    appendContentBlock(TEST_ROOT, 'session-1', 'assistant', {
      type: 'tool_use',
      id: 'toolu_aaa',
      name: 'Bash',
      input: { command: 'echo a' },
    })
    appendContentBlock(TEST_ROOT, 'session-1', 'assistant', {
      type: 'tool_use',
      id: 'toolu_bbb',
      name: 'Bash',
      input: { command: 'echo b' },
    })

    // User: 2 tool_result
    appendContentBlock(TEST_ROOT, 'session-1', 'user', {
      type: 'tool_result',
      tool_use_id: 'toolu_aaa',
      content: 'a',
      is_error: false,
    })
    appendContentBlock(TEST_ROOT, 'session-1', 'user', {
      type: 'tool_result',
      tool_use_id: 'toolu_bbb',
      content: 'b',
      is_error: false,
    })

    // Assistant: final text
    appendContentBlock(TEST_ROOT, 'session-1', 'assistant', {
      type: 'text',
      text: 'Both done',
    })

    const messages = getMessages(TEST_ROOT, 'session-1')
    expect(messages).toHaveLength(4)

    // User prompt
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toHaveLength(1)

    // Assistant: text + 2 tool_use in one message
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toHaveLength(3)
    expect(messages[1].content[0].type).toBe('text')
    expect(messages[1].content[1].type).toBe('tool_use')
    expect(messages[1].content[2].type).toBe('tool_use')

    // User: 2 tool_result in one message
    expect(messages[2].role).toBe('user')
    expect(messages[2].content).toHaveLength(2)
    expect(messages[2].content[0].type).toBe('tool_result')
    expect(messages[2].content[1].type).toBe('tool_result')

    // Assistant: final response
    expect(messages[3].role).toBe('assistant')
    expect(messages[3].content).toHaveLength(1)
    expect(messages[3].content[0]).toEqual({ type: 'text', text: 'Both done' })
  })
})

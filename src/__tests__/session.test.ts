import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import {
  createWorkspace,
  saveSession,
  getSession,
  updateSessionStatus,
  listSessions,
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
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
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
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
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
      created_at: '2026-02-16T00:00:00.000Z',
      last_active_at: '2026-02-16T00:00:00.000Z',
    })

    saveSession(TEST_ROOT, 'session-2', {
      workspace: '/tmp/b',
      env: 'readonly',
      repo: '/path/to/repo',
      branch: 'main',
      status: 'running',
      created_at: '2026-02-16T01:00:00.000Z',
      last_active_at: '2026-02-16T01:00:00.000Z',
    })

    const sessions = listSessions(TEST_ROOT)
    expect(Object.keys(sessions)).toHaveLength(2)
    expect(sessions['session-1'].env).toBe('full')
    expect(sessions['session-2'].env).toBe('readonly')
  })
})

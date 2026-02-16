import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import type { MessageEntry } from '../types.js'

export interface SessionMetadata {
  workspace: string
  env: string
  repo: string | null
  branch: string | null
  status: 'idle' | 'running' | 'cancelled'
  created_at: string
  last_active_at: string
}

export interface SessionStore {
  [sessionId: string]: SessionMetadata
}

function sessionsFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, 'sessions.json')
}

function loadStore(workspaceRoot: string): SessionStore {
  const filePath = sessionsFilePath(workspaceRoot)
  if (!existsSync(filePath)) {
    return {}
  }
  const content = readFileSync(filePath, 'utf-8')
  return JSON.parse(content) as SessionStore
}

function saveStore(workspaceRoot: string, store: SessionStore): void {
  const filePath = sessionsFilePath(workspaceRoot)
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8')
}

export function createWorkspace(
  workspaceRoot: string,
  repo?: string,
  branch?: string,
): { workspacePath: string } {
  const dirName = randomUUID()
  const workspacePath = join(workspaceRoot, dirName)

  mkdirSync(workspaceRoot, { recursive: true })

  if (repo) {
    const args = ['git', 'clone']
    if (branch) {
      args.push('--branch', branch)
    }
    args.push(repo, workspacePath)

    try {
      execSync(args.join(' '), { stdio: 'pipe' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`git clone failed: ${message}`)
    }
  } else {
    mkdirSync(workspacePath, { recursive: true })
  }

  return { workspacePath }
}

export function saveSession(
  workspaceRoot: string,
  sessionId: string,
  metadata: SessionMetadata,
): void {
  const store = loadStore(workspaceRoot)
  store[sessionId] = metadata
  saveStore(workspaceRoot, store)
}

export function getSession(
  workspaceRoot: string,
  sessionId: string,
): SessionMetadata | null {
  const store = loadStore(workspaceRoot)
  return store[sessionId] ?? null
}

export function updateSessionStatus(
  workspaceRoot: string,
  sessionId: string,
  status: SessionMetadata['status'],
): void {
  const store = loadStore(workspaceRoot)
  if (store[sessionId]) {
    store[sessionId].status = status
    store[sessionId].last_active_at = new Date().toISOString()
    saveStore(workspaceRoot, store)
  }
}

export function listSessions(workspaceRoot: string): SessionStore {
  return loadStore(workspaceRoot)
}

function messagesFilePath(workspaceRoot: string, sessionId: string): string {
  return join(workspaceRoot, `messages-${sessionId}.json`)
}

export function appendMessage(
  workspaceRoot: string,
  sessionId: string,
  message: MessageEntry,
): void {
  const filePath = messagesFilePath(workspaceRoot, sessionId)
  const messages = getMessages(workspaceRoot, sessionId)
  messages.push(message)
  writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8')
}

export function getMessages(
  workspaceRoot: string,
  sessionId: string,
): MessageEntry[] {
  const filePath = messagesFilePath(workspaceRoot, sessionId)
  if (!existsSync(filePath)) {
    return []
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')) as MessageEntry[]
}

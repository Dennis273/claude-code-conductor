import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { z } from 'zod'
import type { Message, ContentBlock } from '../types.js'
import type { McpServerConfig, HttpMcpServerConfig } from '../config.js'

export interface SessionMetadata {
  workspace: string
  env: string
  repo: string | null
  branch: string | null
  status: 'idle' | 'running' | 'cancelled'
  title: string
  created_at: string
  last_active_at: string
  run_message_offset: number | null
}

export interface SessionStore {
  [sessionId: string]: SessionMetadata
}

const SessionMetadataSchema = z.object({
  workspace: z.string(),
  env: z.string(),
  repo: z.string().nullable(),
  branch: z.string().nullable(),
  status: z.enum(['idle', 'running', 'cancelled']),
  title: z.string(),
  created_at: z.string(),
  last_active_at: z.string(),
  run_message_offset: z.number().nullable().optional().default(null),
})

const SessionStoreSchema = z.record(z.string(), SessionMetadataSchema)

const ContentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.string(),
    is_error: z.boolean(),
  }),
])

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.array(ContentBlockSchema),
  timestamp: z.string(),
})

const MessagesSchema = z.array(MessageSchema)

function sessionsFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, 'sessions.json')
}

function loadStore(workspaceRoot: string): SessionStore {
  const filePath = sessionsFilePath(workspaceRoot)
  if (!existsSync(filePath)) {
    return {}
  }
  const content = readFileSync(filePath, 'utf-8')
  const result = SessionStoreSchema.safeParse(JSON.parse(content))
  return result.success ? result.data : {}
}

function saveStore(workspaceRoot: string, store: SessionStore): void {
  const filePath = sessionsFilePath(workspaceRoot)
  writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8')
}

export function writeMcpConfig(
  workspacePath: string,
  mcpServers?: Record<string, McpServerConfig>,
  httpServers?: Record<string, HttpMcpServerConfig>,
): void {
  if (!mcpServers && !httpServers) return

  const resolved: Record<string, Record<string, unknown>> = {}

  if (mcpServers) {
    for (const [name, server] of Object.entries(mcpServers)) {
      const entry: Record<string, unknown> = {
        command: server.command,
        args: server.args.map((arg) => arg.replaceAll('{{workspace}}', workspacePath)),
      }

      if (server.env) {
        const envResolved: Record<string, string> = {}
        for (const [k, v] of Object.entries(server.env)) {
          envResolved[k] = v.replaceAll('{{workspace}}', workspacePath)
        }
        entry.env = envResolved
      }

      resolved[name] = entry
    }
  }

  if (httpServers) {
    for (const [name, server] of Object.entries(httpServers)) {
      resolved[name] = { type: server.type, url: server.url }
    }
  }

  writeFileSync(
    join(workspacePath, '.mcp.json'),
    JSON.stringify({ mcpServers: resolved }, null, 2),
    'utf-8',
  )
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

export function updateSessionTitle(
  workspaceRoot: string,
  sessionId: string,
  title: string,
): void {
  const store = loadStore(workspaceRoot)
  if (store[sessionId]) {
    store[sessionId].title = title
    saveStore(workspaceRoot, store)
  }
}

export function updateRunMessageOffset(
  workspaceRoot: string,
  sessionId: string,
  offset: number,
): void {
  const store = loadStore(workspaceRoot)
  if (store[sessionId]) {
    store[sessionId].run_message_offset = offset
    saveStore(workspaceRoot, store)
  }
}

export function listSessions(workspaceRoot: string): SessionStore {
  return loadStore(workspaceRoot)
}

export function recoverSessions(workspaceRoot: string): number {
  const store = loadStore(workspaceRoot)
  let recovered = 0
  for (const id of Object.keys(store)) {
    if (store[id].status === 'running') {
      store[id].status = 'idle'
      store[id].last_active_at = new Date().toISOString()
      recovered++
    }
  }
  if (recovered > 0) {
    saveStore(workspaceRoot, store)
  }
  return recovered
}

function messagesFilePath(workspaceRoot: string, sessionId: string): string {
  return join(workspaceRoot, `messages-${sessionId}.json`)
}

export function appendContentBlock(
  workspaceRoot: string,
  sessionId: string,
  role: 'user' | 'assistant',
  block: ContentBlock,
): void {
  const filePath = messagesFilePath(workspaceRoot, sessionId)
  const messages = getMessages(workspaceRoot, sessionId)
  const last = messages[messages.length - 1]

  if (last && last.role === role) {
    last.content.push(block)
  } else {
    messages.push({
      role,
      content: [block],
      timestamp: new Date().toISOString(),
    })
  }

  writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8')
}

export function getMessages(
  workspaceRoot: string,
  sessionId: string,
): Message[] {
  const filePath = messagesFilePath(workspaceRoot, sessionId)
  if (!existsSync(filePath)) {
    return []
  }
  const result = MessagesSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf-8')))
  return result.success ? result.data : []
}

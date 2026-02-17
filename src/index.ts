import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'
import { createRoutes, getRunningCount, forceAbortAll } from './api/routes.js'
import { recoverSessions } from './core/session.js'
import { destroyAll } from './core/playwright-manager.js'

const config = loadConfig()

const recovered = recoverSessions(config.workspace_root)
if (recovered > 0) {
  console.log(`Recovered ${recovered} stale session(s) from previous run`)
}

const app = createRoutes(config)

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Conductor listening on http://localhost:${info.port}`)
})

let shuttingDown = false

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`\n${signal} received, shutting down...`)
  server.close()

  const deadline = Date.now() + 30_000
  while (getRunningCount() > 0 && Date.now() < deadline) {
    console.log(`Waiting for ${getRunningCount()} running process(es)...`)
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (getRunningCount() > 0) {
    console.log(`Timeout: force-aborting ${getRunningCount()} process(es)`)
    forceAbortAll()
    await new Promise((r) => setTimeout(r, 1000))
  }

  await destroyAll()
  console.log('Shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

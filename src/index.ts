import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'
import { createRoutes, getRunningCount, forceAbortAll } from './api/routes.js'
import { recoverSessions } from './core/session.js'
import { createPlaywrightManager } from './core/playwright-manager.js'
import { createLogger } from './core/logger.js'

const config = loadConfig()
const logger = createLogger(config.log)

const recovered = recoverSessions(config.workspace_root)
if (recovered > 0) {
  logger.info({ recovered }, 'recovered stale sessions from previous run')
}

const playwright = createPlaywrightManager(config.workspace_root, logger)
const app = createRoutes(config, playwright, logger)

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  logger.info({ port: info.port }, 'Conductor listening')
})

let shuttingDown = false

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true

  logger.info({ signal }, 'shutting down')
  server.close()

  const deadline = Date.now() + 30_000
  while (getRunningCount() > 0 && Date.now() < deadline) {
    logger.info({ runningCount: getRunningCount() }, 'waiting for running processes')
    await new Promise((r) => setTimeout(r, 1000))
  }

  if (getRunningCount() > 0) {
    logger.warn({ runningCount: getRunningCount() }, 'timeout: force-aborting processes')
    forceAbortAll()
    await new Promise((r) => setTimeout(r, 1000))
  }

  await playwright.destroyAll()
  logger.info('shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

import { serve } from '@hono/node-server'
import { loadConfig } from './config.js'
import { createRoutes } from './api/routes.js'

const config = loadConfig()
const app = createRoutes(config)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Conductor listening on http://localhost:${info.port}`)
})

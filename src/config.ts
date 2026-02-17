import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface PlaywrightConfig {
  headless: boolean
}

export interface EnvConfig {
  allowedTools: string
  max_turns: number
  env: Record<string, string>
  mcpServers?: Record<string, McpServerConfig>
  playwright?: PlaywrightConfig
}

export interface Config {
  port: number
  concurrency: number
  workspace_root: string
  envs: Record<string, EnvConfig>
}

function getConfigPath(): string {
  const args = process.argv.slice(2)
  const configIndex = args.indexOf('--config')
  if (configIndex !== -1 && args[configIndex + 1]) {
    return resolve(args[configIndex + 1])
  }
  return resolve('conductor.yaml')
}

export function validate(raw: unknown): Config {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Config must be a YAML object')
  }

  const obj = raw as Record<string, unknown>

  if (typeof obj.port !== 'number') {
    throw new Error('Config: "port" is required and must be a number')
  }

  if (typeof obj.concurrency !== 'number' || obj.concurrency < 1) {
    throw new Error('Config: "concurrency" is required and must be a positive number')
  }

  if (typeof obj.workspace_root !== 'string' || obj.workspace_root.length === 0) {
    throw new Error('Config: "workspace_root" is required and must be a non-empty string')
  }

  if (typeof obj.envs !== 'object' || obj.envs === null || Object.keys(obj.envs).length === 0) {
    throw new Error('Config: "envs" is required and must contain at least one env')
  }

  const envs: Record<string, EnvConfig> = {}
  for (const [name, envRaw] of Object.entries(obj.envs as Record<string, unknown>)) {
    if (typeof envRaw !== 'object' || envRaw === null) {
      throw new Error(`Config: env "${name}" must be an object`)
    }

    const env = envRaw as Record<string, unknown>

    if (typeof env.allowedTools !== 'string' || env.allowedTools.length === 0) {
      throw new Error(`Config: env "${name}" requires "allowedTools" as a non-empty string`)
    }

    if (typeof env.max_turns !== 'number' || env.max_turns < 1) {
      throw new Error(`Config: env "${name}" requires "max_turns" as a positive number`)
    }

    const envVars: Record<string, string> = {}
    if (env.env !== undefined) {
      if (typeof env.env !== 'object' || env.env === null) {
        throw new Error(`Config: env "${name}.env" must be an object`)
      }
      for (const [k, v] of Object.entries(env.env as Record<string, unknown>)) {
        if (typeof v !== 'string') {
          throw new Error(`Config: env "${name}.env.${k}" must be a string`)
        }
        envVars[k] = v
      }
    }

    let mcpServers: Record<string, McpServerConfig> | undefined
    if (env.mcpServers !== undefined) {
      if (typeof env.mcpServers !== 'object' || env.mcpServers === null) {
        throw new Error(`Config: env "${name}.mcpServers" must be an object`)
      }
      mcpServers = {}
      for (const [serverName, serverRaw] of Object.entries(env.mcpServers as Record<string, unknown>)) {
        if (typeof serverRaw !== 'object' || serverRaw === null) {
          throw new Error(`Config: env "${name}.mcpServers.${serverName}" must be an object`)
        }
        const server = serverRaw as Record<string, unknown>

        if (typeof server.command !== 'string' || server.command.length === 0) {
          throw new Error(`Config: env "${name}.mcpServers.${serverName}.command" must be a non-empty string`)
        }

        if (!Array.isArray(server.args) || !server.args.every((a: unknown) => typeof a === 'string')) {
          throw new Error(`Config: env "${name}.mcpServers.${serverName}.args" must be an array of strings`)
        }

        const serverEnv: Record<string, string> | undefined = (() => {
          if (server.env === undefined) return undefined
          if (typeof server.env !== 'object' || server.env === null) {
            throw new Error(`Config: env "${name}.mcpServers.${serverName}.env" must be an object`)
          }
          const result: Record<string, string> = {}
          for (const [ek, ev] of Object.entries(server.env as Record<string, unknown>)) {
            if (typeof ev !== 'string') {
              throw new Error(`Config: env "${name}.mcpServers.${serverName}.env.${ek}" must be a string`)
            }
            result[ek] = ev
          }
          return result
        })()

        mcpServers[serverName] = {
          command: server.command,
          args: server.args as string[],
          ...(serverEnv !== undefined && { env: serverEnv }),
        }
      }
    }

    let playwright: PlaywrightConfig | undefined
    if (env.playwright !== undefined) {
      if (typeof env.playwright !== 'object' || env.playwright === null) {
        throw new Error(`Config: env "${name}.playwright" must be an object`)
      }
      const pw = env.playwright as Record<string, unknown>
      if (typeof pw.headless !== 'boolean') {
        throw new Error(`Config: env "${name}.playwright.headless" must be a boolean`)
      }
      playwright = { headless: pw.headless }
    }

    envs[name] = {
      allowedTools: env.allowedTools,
      max_turns: env.max_turns,
      env: envVars,
      ...(mcpServers !== undefined && { mcpServers }),
      ...(playwright !== undefined && { playwright }),
    }
  }

  return {
    port: obj.port,
    concurrency: obj.concurrency,
    workspace_root: obj.workspace_root,
    envs,
  }
}

export function loadConfig(): Config {
  const configPath = getConfigPath()

  let content: string
  try {
    content = readFileSync(configPath, 'utf-8')
  } catch {
    throw new Error(`Cannot read config file: ${configPath}`)
  }

  const raw = parseYaml(content)
  return validate(raw)
}

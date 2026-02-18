import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface McpServerConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface HttpMcpServerConfig {
  type: 'http'
  url: string
}

export interface EnvConfig {
  allowedTools: string
  max_turns?: number
  env: Record<string, string>
  mcpServers?: Record<string, McpServerConfig>
  playwright?: true
  instructions?: string
}

export interface LogConfig {
  file: string
  level: string
  size: string
  max_files: number
}

export interface Config {
  port: number
  concurrency: number
  workspace_root: string
  envs: Record<string, EnvConfig>
  log?: LogConfig
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

    if (env.max_turns !== undefined && (typeof env.max_turns !== 'number' || env.max_turns < 1)) {
      throw new Error(`Config: env "${name}" "max_turns" must be a positive number when set`)
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

    let playwright: true | undefined
    if (env.playwright !== undefined) {
      if (env.playwright !== true) {
        throw new Error(`Config: env "${name}.playwright" must be true`)
      }
      playwright = true
    }

    let instructions: string | undefined
    if (env.instructions !== undefined) {
      if (typeof env.instructions !== 'string') {
        throw new Error(`Config: env "${name}.instructions" must be a string`)
      }
      instructions = env.instructions
    }

    const maxTurns = typeof env.max_turns === 'number' ? env.max_turns : undefined

    envs[name] = {
      allowedTools: env.allowedTools,
      env: envVars,
      ...(maxTurns !== undefined && { max_turns: maxTurns }),
      ...(mcpServers !== undefined && { mcpServers }),
      ...(playwright !== undefined && { playwright }),
      ...(instructions !== undefined && { instructions }),
    }
  }

  let log: LogConfig | undefined
  if (obj.log !== undefined) {
    if (typeof obj.log !== 'object' || obj.log === null) {
      throw new Error('Config: "log" must be an object')
    }

    const logRaw = obj.log as Record<string, unknown>

    if (typeof logRaw.file !== 'string' || logRaw.file.length === 0) {
      throw new Error('Config: "log.file" is required and must be a non-empty string')
    }

    const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']
    if (logRaw.level !== undefined && (typeof logRaw.level !== 'string' || !validLevels.includes(logRaw.level))) {
      throw new Error('Config: "log.level" must be one of: fatal, error, warn, info, debug, trace')
    }

    if (logRaw.size !== undefined && typeof logRaw.size !== 'string') {
      throw new Error('Config: "log.size" must be a string')
    }

    if (logRaw.max_files !== undefined && (typeof logRaw.max_files !== 'number' || logRaw.max_files < 1)) {
      throw new Error('Config: "log.max_files" must be a positive number')
    }

    log = {
      file: logRaw.file,
      level: typeof logRaw.level === 'string' ? logRaw.level : 'info',
      size: typeof logRaw.size === 'string' ? logRaw.size : '10m',
      max_files: typeof logRaw.max_files === 'number' ? logRaw.max_files : 5,
    }
  }

  return {
    port: obj.port,
    concurrency: obj.concurrency,
    workspace_root: obj.workspace_root,
    envs,
    ...(log !== undefined && { log }),
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

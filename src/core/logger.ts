import pino from 'pino'
import type { LogConfig } from '../config.js'

export function createLogger(logConfig?: LogConfig): pino.Logger {
  if (!logConfig) {
    return pino({ level: 'info' })
  }

  const transport = pino.transport({
    targets: [
      {
        target: 'pino/file',
        options: { destination: 1 },
        level: logConfig.level,
      },
      {
        target: 'pino-roll',
        options: {
          file: logConfig.file,
          size: logConfig.size,
          limit: { count: logConfig.max_files },
          mkdir: true,
        },
        level: logConfig.level,
      },
    ],
  })

  return pino({ level: logConfig.level }, transport)
}

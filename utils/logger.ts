// Log levels hierarchy: error = 0, warn = 1, info = 2, debug = 3
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase() as keyof typeof LOG_LEVELS] ?? LOG_LEVELS.info;

const shouldLog = (level: keyof typeof LOG_LEVELS): boolean => {
  return LOG_LEVELS[level] <= currentLogLevel;
};

export const logger = {
  info: (...args: any[]) => shouldLog('info') && console.log('[INFO]', ...args),
  warn: (...args: any[]) => shouldLog('warn') && console.warn('[WARN]', ...args),
  error: (...args: any[]) => shouldLog('error') && console.error('[ERROR]', ...args),
  debug: (...args: any[]) => shouldLog('debug') && console.debug('[DEBUG]', ...args),
};

export default logger;

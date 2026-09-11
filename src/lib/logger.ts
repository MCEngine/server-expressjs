import type { Config } from '../config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

const ORDER: Record<LogLevel | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/**
 * A JSON-line logger over `console`, with no dependency.
 *
 * Structured output because these lines are read by a log aggregator far more
 * often than by a person, and a printf-style line has to be re-parsed to answer
 * "which account did that". A dependency would buy transports and redaction
 * neither of which this service needs yet; when it does, this is one file to
 * replace and every call site already passes fields rather than interpolating.
 */
export function createLogger(config: Pick<Config, 'LOG_LEVEL'>): Logger {
  const threshold = ORDER[config.LOG_LEVEL];

  const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...fields,
    });
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Logger } from '../src/lib/logger.js';
import type { ReadinessProbe } from '../src/routes/health.js';

/** A logger that records instead of printing, so a suite can assert on it. */
export function recordingLogger(): Logger & { lines: { level: string; message: string }[] } {
  const lines: { level: string; message: string }[] = [];
  const push = (level: string) => (message: string) => void lines.push({ level, message });
  return {
    lines,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
  };
}

export function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'a'.repeat(32),
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function testApp(probes: readonly ReadinessProbe[] = []) {
  const logger = recordingLogger();
  return { app: createApp({ config: testConfig(), logger, probes }), logger };
}

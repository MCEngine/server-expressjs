import { z } from 'zod';

/**
 * Every environment variable this service reads, validated once at startup.
 *
 * Parsing here rather than reaching for `process.env` at the call site means a
 * missing or malformed value fails the process immediately, with the name of
 * the key, instead of surfacing as `undefined` somewhere far away at the first
 * request that happens to need it.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /**
   * Which SQL engine the persistence layer targets. Kept separate from the URL
   * because the URL alone does not distinguish MySQL from MariaDB, and the two
   * differ in ways the schema has to know about.
   */
  DATABASE_PROVIDER: z
    .enum(['sqlite', 'postgresql', 'mysql', 'mariadb'])
    .default('sqlite'),
  DATABASE_URL: z.string().min(1).default('file:./dev.sqlite'),

  /** Signing key for access tokens. Refresh tokens are random, not signed. */
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  /** Where artifact bytes are written when storage is backed by the disk. */
  STORAGE_DIR: z.string().min(1).default('./storage'),

  /** Public origin of the web panel, for CORS and OAuth redirects. */
  PANEL_ORIGIN: z.string().url().default('http://localhost:5173'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  /**
   * Seeds a demo account and advertises its credentials on `GET /meta`.
   *
   * **Off unless deliberately turned on.** The demo account is a real user
   * account: whoever can reach the panel can sign in as it, create an
   * organization, and publish artifacts that Minecraft servers download and
   * execute. It exists so an evaluation needs no registration, and it is not
   * safe on a deployment you would mind a stranger publishing into.
   *
   * `z.coerce.boolean()` is wrong here -- it makes the string "false" true.
   */
  DEMO_ACCOUNT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DEMO_ACCOUNT_HANDLE: z.string().min(2).max(39).default('demo'),
  DEMO_ACCOUNT_EMAIL: z.string().email().default('demo@mcengine.local'),
  DEMO_ACCOUNT_PASSWORD: z.string().min(12).default('demo-password-1234'),
});

export type Config = Readonly<z.infer<typeof schema>>;

/**
 * Validates `source` and returns the typed configuration.
 *
 * Takes the environment as an argument rather than reading the global so a test
 * can build a config without mutating `process.env`, which is shared state that
 * leaks between test files.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return Object.freeze(result.data);
}

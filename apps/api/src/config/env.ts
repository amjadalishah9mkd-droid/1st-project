import { z } from 'zod';

/**
 * Environment validation (M10-W3).
 * Called once at bootstrap, before Nest starts. Development keeps forgiving
 * defaults; production fails fast on missing/weak secrets so a misconfigured
 * deployment never comes up half-secure.
 */
const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .url('DATABASE_URL must be a valid connection URL'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  FILE_URL_SECRET: z.string().optional(),
  CORS_ORIGINS: z.string().optional(), // comma-separated allowlist
  UPLOAD_DIR: z.string().optional(),
  SEED_DEMO: z.string().optional(),
  ALLOW_DEMO_SEED: z.string().optional(),
  // M11-W2 — Google OIDC (optional feature; endpoints return
  // FEATURE_DISABLED when unset). If any of the three is set, all must be.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_BASE: z
    .string()
    .url('OAUTH_REDIRECT_BASE must be a URL, e.g. https://campus.example.edu')
    .optional(),
  // M12-W1 — transactional email (optional feature; unset → mail disabled).
  // SMTP_URL and MAIL_FROM are an all-or-none pair.
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  APP_BASE_URL: z
    .string()
    .url('APP_BASE_URL must be a URL, e.g. https://campus.example.edu')
    .optional(),
});

export type AppEnv = z.infer<typeof baseSchema>;

const MIN_SECRET_LENGTH = 32;

export function validateEnv(
  env: Record<string, string | undefined> = process.env,
): AppEnv {
  const parsed = baseSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const config = parsed.data;

  // Secrets are mandatory (and non-trivial) outside development/test.
  if (config.NODE_ENV === 'production') {
    const required: Array<[string, string | undefined]> = [
      ['JWT_ACCESS_SECRET', config.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', config.JWT_REFRESH_SECRET],
      ['FILE_URL_SECRET', config.FILE_URL_SECRET],
    ];
    for (const [name, value] of required) {
      if (!value) {
        throw new Error(
          `Invalid environment configuration — ${name} is required in production`,
        );
      }
      if (value.length < MIN_SECRET_LENGTH) {
        throw new Error(
          `Invalid environment configuration — ${name} must be at least ${MIN_SECRET_LENGTH} characters`,
        );
      }
    }
  } else if (!config.JWT_ACCESS_SECRET) {
    // Development still needs *a* secret for the JwtModule to boot.
    throw new Error(
      'Invalid environment configuration — JWT_ACCESS_SECRET is not set. Run .alloy/populate-env.sh',
    );
  }

  // Google OIDC: all-or-none in every environment. A half-configured OAuth
  // client is a misconfiguration, never a fallback.
  const googleVars: Array<[string, string | undefined]> = [
    ['GOOGLE_CLIENT_ID', config.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', config.GOOGLE_CLIENT_SECRET],
    ['OAUTH_REDIRECT_BASE', config.OAUTH_REDIRECT_BASE],
  ];
  const setCount = googleVars.filter(([, v]) => v).length;
  if (setCount > 0 && setCount < googleVars.length) {
    const missing = googleVars
      .filter(([, v]) => !v)
      .map(([name]) => name)
      .join(', ');
    throw new Error(
      `Invalid environment configuration — Google OIDC is partially configured; missing: ${missing}`,
    );
  }

  // Mail (M12-W1): all-or-none pair, same philosophy as Google OIDC.
  const mailVars: Array<[string, string | undefined]> = [
    ['SMTP_URL', config.SMTP_URL],
    ['MAIL_FROM', config.MAIL_FROM],
  ];
  const mailSet = mailVars.filter(([, v]) => v).length;
  if (mailSet > 0 && mailSet < mailVars.length) {
    const missing = mailVars
      .filter(([, v]) => !v)
      .map(([name]) => name)
      .join(', ');
    throw new Error(
      `Invalid environment configuration — mail is partially configured; missing: ${missing}`,
    );
  }

  return config;
}

/** Parses the CORS allowlist. Empty in production = same-origin only. */
export function corsOrigins(config: AppEnv): boolean | string[] {
  if (config.CORS_ORIGINS) {
    return config.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  // Dev/test: reflect any origin (local web app on another port).
  // Production without an allowlist: no cross-origin browsers allowed.
  return config.NODE_ENV === 'production' ? [] : true;
}

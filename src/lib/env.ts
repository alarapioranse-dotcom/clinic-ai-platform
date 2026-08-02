import type { AppEnvironment } from '@/types';

/**
 * The only file in this repo permitted to read `process.env` directly.
 * Everything else imports `env` from here.
 */

const ALLOWED_APP_ENVS: readonly AppEnvironment[] = ['development', 'staging', 'production'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireAppEnv(name: string): AppEnvironment {
  const value = requireEnv(name);
  if (!ALLOWED_APP_ENVS.includes(value as AppEnvironment)) {
    throw new Error(
      `Invalid value for ${name}: "${value}". Expected one of: ${ALLOWED_APP_ENVS.join(', ')}`,
    );
  }
  return value as AppEnvironment;
}

export const env = {
  appUrl: requireEnv('NEXT_PUBLIC_APP_URL'),
  appEnv: requireAppEnv('NEXT_PUBLIC_APP_ENV'),
} as const;

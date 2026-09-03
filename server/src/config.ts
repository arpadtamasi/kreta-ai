import { Sealer } from "./seal.js";

export interface Config {
  /** Public origin this service is reachable at; also the OAuth issuer. */
  issuer: string | undefined;
  /** Exact redirect URIs a registered MCP client may use. */
  allowedRedirectUris: string[];
  sealer: Sealer;
  authorizationCodeTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshJobAudience: string | undefined;
  refreshJobServiceAccount: string | undefined;
  port: number;
}

/**
 * Claude's own MCP connector callbacks. A dynamically registered client may
 * ask for any redirect_uri; only these are honoured, so a stranger who
 * registers a client cannot point a parent's authorization code at their own
 * server. Override with OAUTH_ALLOWED_REDIRECT_URIS when Claude's callback
 * changes or another client is being tested.
 */
const DEFAULT_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const key = env.TOKEN_SEALING_KEY?.trim();
  if (!key) {
    throw new ConfigError(
      "TOKEN_SEALING_KEY is required — it is the only key protecting every issued token. " +
        "Generate one with `npm run keygen` and store it in Secret Manager.",
    );
  }

  const configured = parseList(env.OAUTH_ALLOWED_REDIRECT_URIS);
  return {
    issuer: env.OAUTH_ISSUER,
    allowedRedirectUris: configured.length > 0 ? configured : DEFAULT_REDIRECT_URIS,
    sealer: Sealer.fromBase64(key),
    authorizationCodeTtlSeconds: parseIntEnv(env.OAUTH_CODE_TTL_SECONDS, 120),
    accessTokenTtlSeconds: parseIntEnv(
      env.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      60 * 60 * 24 * 30, // 30 days; there is no refresh grant (see README).
    ),
    refreshJobAudience: env.REFRESH_JOB_AUDIENCE?.trim() || undefined,
    refreshJobServiceAccount: env.REFRESH_JOB_SERVICE_ACCOUNT?.trim() || undefined,
    port: parseIntEnv(env.PORT, 8080),
  };
}

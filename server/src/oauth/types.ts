/** Payloads carried inside sealed tokens. Nothing here is ever persisted. */

/** One connected child, as it travels inside an access token. */
export interface SealedChild {
  /** Display name the parent typed, used to disambiguate tools' `gyerek` argument. */
  label: string;
  instituteCode: string;
  /** KRÉTA refresh token. Never leaves a sealed token or this process's memory. */
  refreshToken: string;
}

/** The connection an access token stands for. */
export interface SealedSession {
  /** Stable id for this connection; the rotation cache's key. */
  sid: string;
  children: SealedChild[];
  /** When the parent completed the KRÉTA login, epoch milliseconds. */
  connectedAt: number;
}

/** The context an authorization code carries between /authorize and /token. */
export interface SealedAuthorizationCode {
  /** Single-use id, tracked by the replay cache. */
  jti: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  session: SealedSession;
}

declare module "express-serve-static-core" {
  interface Request {
    /** Populated by requireSealedToken once the bearer token has been opened. */
    session?: SealedSession;
  }
}

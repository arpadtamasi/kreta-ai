/** Payloads carried inside sealed tokens. Nothing here is ever persisted. */

/** One connected child reference, as it travels inside an access token. */
export interface SealedChild {
  /** Display name the parent typed, used to disambiguate tools' `gyerek` argument. */
  label: string;
  profileId: string;
  instituteCode: string;
}

/** The connection an access token stands for. */
export interface SealedSession {
  /** Firebase uid whose encrypted profile connections back this grant. */
  uid: string;
  /** Stable id for this connection; the rotation cache's key. */
  sid: string;
  children: SealedChild[];
  /** When the parent approved this Claude connector grant, epoch milliseconds. */
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

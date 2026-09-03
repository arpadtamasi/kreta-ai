export interface VerifiedUser {
  uid: string;
  name?: string;
}

export type VerifyIdToken = (token: string) => Promise<VerifiedUser>;
export type VerifySessionCookie = (cookie: string) => Promise<VerifiedUser>;
export type CreateSessionCookie = (idToken: string, expiresInMs: number) => Promise<string>;

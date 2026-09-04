import { Router, type Request, type Response } from "express";
import { readSessionCookie } from "../auth/session.js";
import type { VerifyIdToken, VerifiedUser, VerifySessionCookie } from "../auth/types.js";
import type { Config } from "../config.js";
import type { ReplayCache } from "../oauth/replayCache.js";
import type { ChildProfileStore } from "../profiles/store.js";
import { randomId } from "../seal.js";
import {
  buildClassroomAuthorizationUrl,
  CLASSROOM_SCOPES,
  ClassroomAuthError,
  exchangeClassroomCode,
  fetchClassroomEmail,
  revokeClassroomToken,
  type ClassroomOAuthClient,
} from "./auth.js";
import { createClassroomConnection, openClassroomCredential } from "./connection.js";

const PROFILE_ID = /^[A-Za-z0-9_-]{8,64}$/u;
const STATE_TTL_SECONDS = 10 * 60;

interface ClassroomState {
  jti: string;
  uid: string;
  profileId: string;
  codeVerifier: string;
  returnTo?: string;
}

export interface ClassroomRouterDeps {
  config: Config;
  store: ChildProfileStore;
  verifyIdToken: VerifyIdToken;
  verifySessionCookie: VerifySessionCookie;
  stateReplayCache: ReplayCache;
  fetchImpl?: typeof fetch;
}

function bearer(req: Request): string | undefined {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function issuerOf(req: Request, config: Config): string {
  return config.issuer?.replace(/\/+$/, "") ?? `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

function oauthClient(req: Request, config: Config): ClassroomOAuthClient | undefined {
  if (!config.classroomClientId || !config.classroomClientSecret) return undefined;
  return {
    clientId: config.classroomClientId,
    clientSecret: config.classroomClientSecret,
    redirectUri: `${issuerOf(req, config)}/api/classroom/callback`,
  };
}

export function createClassroomRouter(deps: ClassroomRouterDeps): Router {
  const router = Router();
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function authenticated(req: Request): Promise<VerifiedUser> {
    const token = bearer(req);
    if (!token) throw new Error("missing_token");
    return deps.verifyIdToken(token);
  }

  /** A szülő oda tér vissza, ahonnan indult: a gyerek saját oldalára, ha ismerjük. */
  const redirect = (
    req: Request,
    res: Response,
    result: string,
    returnTo?: string,
    profileId?: string,
  ): void => {
    const issuer = issuerOf(req, deps.config);
    const target = profileId ? new URL("/gyerek", issuer) : new URL("/", issuer);
    if (profileId) target.searchParams.set("id", profileId);
    target.searchParams.set("classroom", result);
    if (returnTo) target.searchParams.set("return_to", returnTo);
    if (!profileId) target.hash = "gyerekek";
    res.set("Cache-Control", "no-store").redirect(302, target.toString());
  };

  router.post("/authorize", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "A Classroom összekapcsolásához szülői Google-belépés szükséges." });
      return;
    }

    const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
    if (!PROFILE_ID.test(profileId)) {
      res.status(400).json({ error: "Érvénytelen gyerekprofil-azonosító." });
      return;
    }
    const client = oauthClient(req, deps.config);
    if (!client) {
      res.status(503).json({ error: "A Google Classroom még nincs beállítva ezen a szerveren." });
      return;
    }

    try {
      if (!await deps.store.get(user.uid, profileId)) {
        res.status(404).json({ error: "A gyerekprofil nem található." });
        return;
      }
      const codeVerifier = randomId(48);
      const candidateReturnTo = typeof req.body?.returnTo === "string" ? req.body.returnTo : "";
      const returnTo = candidateReturnTo.startsWith("/authorize?") && candidateReturnTo.length <= 12_000
        ? candidateReturnTo
        : undefined;
      const state = deps.config.sealer.seal<ClassroomState>("classroom_state", {
        jti: randomId(),
        uid: user.uid,
        profileId,
        codeVerifier,
        ...(returnTo ? { returnTo } : {}),
      }, STATE_TTL_SECONDS);
      res.set("Cache-Control", "no-store").json({
        authorizationUrl: buildClassroomAuthorizationUrl(client, state, codeVerifier),
      });
    } catch {
      res.status(503).json({ error: "A Classroom összekapcsolását most nem sikerült elindítani." });
    }
  });

  router.get("/callback", async (req, res) => {
    const rawState = firstString(req.query.state);
    if (!rawState) {
      redirect(req, res, "invalid_state");
      return;
    }

    let state: ClassroomState;
    try {
      state = deps.config.sealer.open<ClassroomState>("classroom_state", rawState);
      const sessionCookie = readSessionCookie(req);
      if (!sessionCookie) throw new Error("missing_session");
      const user = await deps.verifySessionCookie(sessionCookie);
      if (user.uid !== state.uid) throw new Error("session_mismatch");
      if (!deps.stateReplayCache.claim(state.jti)) throw new Error("replayed_state");
    } catch {
      redirect(req, res, "invalid_state");
      return;
    }

    const oauthError = firstString(req.query.error);
    if (oauthError) {
      redirect(req, res, oauthError === "admin_policy_enforced" ? "blocked" : "cancelled", state.returnTo, state.profileId);
      return;
    }

    const code = firstString(req.query.code);
    const client = oauthClient(req, deps.config);
    if (!code || !client) {
      redirect(req, res, "failed", state.returnTo, state.profileId);
      return;
    }

    let unstoredRefreshToken: string | undefined;
    try {
      const profile = await deps.store.get(state.uid, state.profileId);
      if (!profile) {
        redirect(req, res, "profile_missing", state.returnTo, state.profileId);
        return;
      }
      const tokens = await exchangeClassroomCode(client, code, state.codeVerifier, fetchImpl);
      const refreshToken = tokens.refreshToken;
      if (!refreshToken) throw new ClassroomAuthError("invalid", "Hiányzó Google refresh token.");
      unstoredRefreshToken = refreshToken;
      const email = await fetchClassroomEmail(tokens.accessToken, fetchImpl);
      const scopes = tokens.scopes.length > 0 ? tokens.scopes : [...CLASSROOM_SCOPES];
      const connection = createClassroomConnection(
        deps.config.sealer,
        refreshToken,
        email,
        scopes,
        deps.config.classroomCredentialTtlSeconds,
      );
      if (!await deps.store.setClassroomConnection(state.uid, state.profileId, connection)) {
        await revokeClassroomToken(refreshToken, fetchImpl).catch(() => undefined);
        unstoredRefreshToken = undefined;
        redirect(req, res, "profile_missing", state.returnTo, state.profileId);
        return;
      }
      unstoredRefreshToken = undefined;
      if (profile.classroomConnection && profile.classroomConnection.email !== email) {
        try {
          const previous = openClassroomCredential(deps.config.sealer, profile.classroomConnection);
          await revokeClassroomToken(previous.refreshToken, fetchImpl);
        } catch {
          // The new, verified connection is already stored; stale revocation must not undo it.
        }
      }
      redirect(req, res, "connected", state.returnTo, state.profileId);
    } catch (error) {
      if (unstoredRefreshToken) {
        await revokeClassroomToken(unstoredRefreshToken, fetchImpl).catch(() => undefined);
      }
      const result = error instanceof ClassroomAuthError && error.code === "blocked" ? "blocked" : "failed";
      redirect(req, res, result, state.returnTo, state.profileId);
    }
  });

  router.delete("/:id/connection", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "A Classroom-kapcsolat törléséhez szülői Google-belépés szükséges." });
      return;
    }
    const id = req.params.id ?? "";
    if (!PROFILE_ID.test(id)) {
      res.status(400).json({ error: "Érvénytelen gyerekprofil-azonosító." });
      return;
    }
    try {
      const profile = await deps.store.get(user.uid, id);
      if (!profile) {
        res.status(404).json({ error: "A gyerekprofil nem található." });
        return;
      }
      if (profile.classroomConnection) {
        try {
          const credential = openClassroomCredential(deps.config.sealer, profile.classroomConnection);
          await revokeClassroomToken(credential.refreshToken, fetchImpl);
        } catch {
          // Local deletion remains available when Google is unreachable or the grant already expired.
        }
      }
      await deps.store.clearClassroomConnection(user.uid, id);
      res.status(204).end();
    } catch {
      res.status(503).json({ error: "A Classroom-kapcsolatot most nem sikerült törölni." });
    }
  });

  return router;
}

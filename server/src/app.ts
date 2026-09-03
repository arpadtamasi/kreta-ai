import express, { type Express, type Request } from "express";
import { OAuth2Client } from "google-auth-library";
import { createSessionRouter } from "./auth/router.js";
import type { CreateSessionCookie, VerifyIdToken, VerifySessionCookie } from "./auth/types.js";
import type { Config } from "./config.js";
import type { login } from "./kreta/auth.js";
import { createMcpPostHandler, mcpMethodNotAllowed } from "./mcp/route.js";
import { requireSealedToken } from "./oauth/middleware.js";
import { ReplayCache } from "./oauth/replayCache.js";
import { createOAuthRouter } from "./oauth/router.js";
import { LOGIN_PAGE_STYLE } from "./oauth/pages.js";
import { BRAND } from "./brand.js";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { createInstituteRouter } from "./institutes/router.js";
import { searchKretaInstitutes, type InstituteSearch } from "./institutes/search.js";
import { createPledgeRouter } from "./pledges/router.js";
import { FirestorePledgeStore, type PledgeStore } from "./pledges/store.js";
import { createChildProfileRouter } from "./profiles/router.js";
import { FirestoreChildProfileStore, type ChildProfileStore } from "./profiles/store.js";
import { createConnectionRefreshRouter, type VerifyRefreshJob } from "./profiles/refreshRouter.js";

export interface AppDeps {
  config: Config;
  /** Injectable so tests drive the whole OAuth + MCP flow without a network. */
  loginImpl?: typeof login;
  fetchImpl?: typeof fetch;
  pledgeStore?: PledgeStore;
  childProfileStore?: ChildProfileStore;
  verifyFirebaseIdToken?: VerifyIdToken;
  createFirebaseSessionCookie?: CreateSessionCookie;
  verifyFirebaseSessionCookie?: VerifySessionCookie;
  searchInstitutes?: InstituteSearch;
  verifyRefreshJob?: VerifyRefreshJob;
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const app = express();

  app.set("trust proxy", true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const issuerOf = (req: Request): string =>
    config.issuer?.replace(/\/+$/, "") ?? `${req.protocol}://${req.get("host") ?? "localhost"}`;

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: BRAND.name });
  });

  app.get("/authorize.css", (_req, res) => {
    res.type("text/css").set("Cache-Control", "public, max-age=3600").send(LOGIN_PAGE_STYLE);
  });

  const firebaseApp = getApps()[0] ?? initializeApp();
  const firebaseAuth = getAuth(firebaseApp);
  const pledgeStore = deps.pledgeStore ?? new FirestorePledgeStore(getFirestore(firebaseApp));
  const childProfileStore = deps.childProfileStore ?? new FirestoreChildProfileStore(getFirestore(firebaseApp));
  const oidcClient = new OAuth2Client();
  const verifyFirebaseIdToken: VerifyIdToken =
    deps.verifyFirebaseIdToken ??
    (async (token) => {
      const decoded = await firebaseAuth.verifyIdToken(token);
      return { uid: decoded.uid, name: decoded.name };
    });
  const createFirebaseSessionCookie: CreateSessionCookie =
    deps.createFirebaseSessionCookie ??
    (async (idToken, expiresInMs) => {
      const decoded = await firebaseAuth.verifyIdToken(idToken);
      const signedInAtMs = decoded.auth_time * 1000;
      if (!Number.isFinite(signedInAtMs) || Date.now() - signedInAtMs > 5 * 60 * 1000) {
        throw new Error("recent_sign_in_required");
      }
      return firebaseAuth.createSessionCookie(idToken, { expiresIn: expiresInMs });
    });
  const verifyFirebaseSessionCookie: VerifySessionCookie =
    deps.verifyFirebaseSessionCookie ??
    (async (cookie) => {
      const decoded = await firebaseAuth.verifySessionCookie(cookie, true);
      return { uid: decoded.uid, name: decoded.name };
    });

  app.use("/api/pledges", createPledgeRouter({ store: pledgeStore, verifyIdToken: verifyFirebaseIdToken }));
  app.use(
    "/api/institutes",
    createInstituteRouter({
      verifyIdToken: verifyFirebaseIdToken,
      search: deps.searchInstitutes ?? searchKretaInstitutes,
    }),
  );
  app.use(
    "/api/session",
    createSessionRouter({
      createSessionCookie: createFirebaseSessionCookie,
      verifySessionCookie: verifyFirebaseSessionCookie,
      issuerOf,
    }),
  );
  app.use(
    "/api/profiles",
    createChildProfileRouter({
      store: childProfileStore,
      verifyIdToken: verifyFirebaseIdToken,
      config,
      ...(deps.loginImpl ? { loginImpl: deps.loginImpl } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    }),
  );
  const verifyRefreshJob: VerifyRefreshJob = deps.verifyRefreshJob ?? (async (token) => {
    if (!config.refreshJobAudience || !config.refreshJobServiceAccount) return false;
    const ticket = await oidcClient.verifyIdToken({ idToken: token, audience: config.refreshJobAudience });
    const payload = ticket.getPayload();
    return payload?.email_verified === true && payload.email === config.refreshJobServiceAccount;
  });
  app.use(
    "/internal/refresh-connections",
    createConnectionRefreshRouter({
      store: childProfileStore,
      sealer: config.sealer,
      verifyRefreshJob,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    }),
  );

  app.use(
    createOAuthRouter({
      config,
      childProfileStore,
      verifySessionCookie: verifyFirebaseSessionCookie,
      // A code lives briefly, so remembering redeemed ones for a few times
      // its TTL is enough to cover every code that could still be replayed.
      codeReplayCache: new ReplayCache(config.authorizationCodeTtlSeconds * 5 * 1000),
    }),
  );

  const mcpDeps = {
    childProfileStore,
    sealer: config.sealer,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  };
  const guard = requireSealedToken(config.sealer, issuerOf);
  app.post("/mcp", guard, createMcpPostHandler(mcpDeps));
  app.get("/mcp", guard, mcpMethodNotAllowed);
  app.delete("/mcp", guard, mcpMethodNotAllowed);

  return app;
}

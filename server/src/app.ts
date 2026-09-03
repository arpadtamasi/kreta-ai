import express, { type Express, type Request } from "express";
import type { Config } from "./config.js";
import type { login } from "./kreta/auth.js";
import { RotationCache } from "./kreta/rotationCache.js";
import { createMcpPostHandler, mcpMethodNotAllowed } from "./mcp/route.js";
import { requireSealedToken } from "./oauth/middleware.js";
import { ReplayCache } from "./oauth/replayCache.js";
import { createOAuthRouter } from "./oauth/router.js";
import { BRAND } from "./brand.js";

export interface AppDeps {
  config: Config;
  /** Injectable so tests drive the whole OAuth + MCP flow without a network. */
  loginImpl?: typeof login;
  fetchImpl?: typeof fetch;
  rotationCache?: RotationCache;
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

  app.use(
    createOAuthRouter({
      config,
      // A code lives briefly, so remembering redeemed ones for a few times
      // its TTL is enough to cover every code that could still be replayed.
      codeReplayCache: new ReplayCache(config.authorizationCodeTtlSeconds * 5 * 1000),
      ...(deps.loginImpl ? { loginImpl: deps.loginImpl } : {}),
    }),
  );

  const mcpDeps = {
    rotationCache: deps.rotationCache ?? new RotationCache(),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  };
  const guard = requireSealedToken(config.sealer, issuerOf);
  app.post("/mcp", guard, createMcpPostHandler(mcpDeps));
  app.get("/mcp", guard, mcpMethodNotAllowed);
  app.delete("/mcp", guard, mcpMethodNotAllowed);

  return app;
}

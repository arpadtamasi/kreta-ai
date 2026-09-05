import { Router, type Request } from "express";
import { z } from "zod";
import {
  clearedSessionCookieHeader,
  readSessionCookie,
  SESSION_TTL_MS,
  sessionCookieHeader,
} from "./session.js";
import type { CreateSessionCookie, VerifySessionCookie } from "./types.js";

export interface SessionRouterDeps {
  createSessionCookie: CreateSessionCookie;
  verifySessionCookie: VerifySessionCookie;
  issuerOf: (req: Request) => string;
}

const sessionSchema = z.object({ idToken: z.string().min(1).max(20_000) });

export function createSessionRouter(deps: SessionRouterDeps): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const origin = req.get("origin");
    if (origin !== deps.issuerOf(req)) {
      res.status(403).json({ error: "A bejelentkezést erről az oldalról nem lehet elindítani." });
      return;
    }

    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Hiányzik a Google-belépés igazolása." });
      return;
    }

    try {
      const cookie = await deps.createSessionCookie(parsed.data.idToken, SESSION_TTL_MS);
      res
        .set("Cache-Control", "no-store")
        .set("Set-Cookie", sessionCookieHeader(cookie))
        .status(204)
        .end();
    } catch {
      res.status(401).json({ error: "A Google-belépés lejárt. Jelentkezz be újra." });
    }
  });

  router.get("/", async (req, res) => {
    const cookie = readSessionCookie(req);
    if (!cookie) {
      res.status(401).json({ signedIn: false });
      return;
    }
    try {
      const user = await deps.verifySessionCookie(cookie);
      res.set("Cache-Control", "no-store").json({ signedIn: true, name: user.name ?? null });
    } catch {
      res.status(401).set("Set-Cookie", clearedSessionCookieHeader()).json({ signedIn: false });
    }
  });

  router.delete("/", (req, res) => {
    // A POST-tal azonos védelem: enélkül egy idegen oldal kijelentkeztethet.
    const origin = req.get("origin");
    if (origin !== deps.issuerOf(req)) {
      res.status(403).json({ error: "A kijelentkezést erről az oldalról nem lehet elindítani." });
      return;
    }
    res.set("Cache-Control", "no-store").set("Set-Cookie", clearedSessionCookieHeader()).status(204).end();
  });

  return router;
}

import { Router, type Request } from "express";
import { z } from "zod";
import type { VerifyIdToken } from "../auth/types.js";
import type { InstituteSearch, InstituteSuggestion } from "./search.js";

export interface InstituteRouterDeps {
  search: InstituteSearch;
  verifyIdToken: VerifyIdToken;
  now?: () => number;
}

const requestSchema = z.object({ q: z.string().trim().min(3).max(80) });
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_SIZE = 100;

function bearer(req: Request): string | undefined {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

export function createInstituteRouter(deps: InstituteRouterDeps): Router {
  const router = Router();
  const cache = new Map<string, { expiresAt: number; suggestions: InstituteSuggestion[] }>();
  const now = deps.now ?? Date.now;

  router.post("/", async (req, res) => {
    const token = bearer(req);
    try {
      if (!token) throw new Error("missing_token");
      await deps.verifyIdToken(token);
    } catch {
      res.status(401).json({ error: "Az intézménykeresőhöz Google-belépés szükséges." });
      return;
    }

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Írj be legalább 3, legfeljebb 80 karaktert." });
      return;
    }

    const query = parsed.data.q.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const cacheKey = query.toLocaleLowerCase("hu-HU");
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      res.set("Cache-Control", "private, max-age=60").json({ suggestions: cached.suggestions });
      return;
    }

    try {
      const suggestions = await deps.search(query);
      cache.delete(cacheKey);
      cache.set(cacheKey, { expiresAt: now() + CACHE_TTL_MS, suggestions });
      while (cache.size > CACHE_SIZE) {
        const oldest = cache.keys().next().value as string | undefined;
        if (!oldest) break;
        cache.delete(oldest);
      }
      res.set("Cache-Control", "private, max-age=60").json({ suggestions });
    } catch {
      res.status(502).json({
        error: "Az eKRÉTA intézménykeresője most nem elérhető. Az intézménykódot kézzel is beírhatod.",
      });
    }
  });

  return router;
}

import { Router, type Request } from "express";
import { z } from "zod";
import type { PledgeStore } from "./store.js";

export interface VerifiedUser {
  uid: string;
  name?: string;
}

export type VerifyIdToken = (token: string) => Promise<VerifiedUser>;

export interface PledgeRouterDeps {
  store: PledgeStore;
  verifyIdToken: VerifyIdToken;
  now?: () => number;
}

const messageSchema = z
  .string()
  .trim()
  .min(10, "Az üzenet legyen legalább 10 karakter.")
  .max(240, "Az üzenet legfeljebb 240 karakter lehet.")
  .refine((value) => !/(https?:\/\/|www\.)/iu.test(value), "Az üzenet nem tartalmazhat hivatkozást.");

const pledgeSchema = z.object({
  message: messageSchema,
  consent: z.literal(true, { error: "A nyilvános közzétételt el kell fogadnod." }),
  website: z.string().max(0).optional().default(""),
});

function bearer(req: Request): string | undefined {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

function publicPledge(
  pledge: Awaited<ReturnType<PledgeStore["upsert"]>>,
  viewerUid?: string,
) {
  return {
    name: pledge.name,
    message: pledge.message,
    createdAt: pledge.createdAt,
    updatedAt: pledge.updatedAt,
    mine: pledge.uid === viewerUid,
  };
}

function publicName(user: VerifiedUser): string {
  const normalized = user.name?.replace(/\s+/gu, " ").trim() ?? "";
  if (normalized.length >= 2 && normalized.length <= 80) return normalized;
  return "Google-fiókkal hitelesített támogató";
}

export function createPledgeRouter(deps: PledgeRouterDeps): Router {
  const router = Router();
  const lastWrite = new Map<string, number>();
  const now = deps.now ?? Date.now;

  async function authenticated(req: Request): Promise<VerifiedUser> {
    const token = bearer(req);
    if (!token) throw new Error("missing_token");
    return deps.verifyIdToken(token);
  }

  router.get("/", async (req, res) => {
    try {
      const token = bearer(req);
      const viewer = token ? await deps.verifyIdToken(token) : undefined;
      const result = await deps.store.list(50);
      res.set("Cache-Control", "no-store").json({
        count: result.count,
        pledges: result.pledges.map((pledge) => publicPledge(pledge, viewer?.uid)),
      });
    } catch {
      res.status(401).json({ error: "A bejelentkezés lejárt. Jelentkezz be újra." });
    }
  });

  router.post("/", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "Az üzenethez Google-belépés szükséges." });
      return;
    }

    const parsed = pledgeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Hibás üzenet." });
      return;
    }

    const previousWrite = lastWrite.get(user.uid) ?? 0;
    if (now() - previousWrite < 60_000) {
      res.status(429).json({ error: "Várj egy percet az üzenet következő módosítása előtt." });
      return;
    }

    try {
      const pledge = await deps.store.upsert({
        uid: user.uid,
        name: publicName(user),
        message: parsed.data.message,
      });
      lastWrite.set(user.uid, now());
      res.status(201).json({ pledge: publicPledge(pledge, user.uid) });
    } catch {
      res.status(503).json({ error: "Az üzenetet most nem sikerült elmenteni. Próbáld újra később." });
    }
  });

  router.delete("/me", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "A törléshez Google-belépés szükséges." });
      return;
    }

    try {
      const deleted = await deps.store.delete(user.uid);
      res.status(deleted ? 204 : 404).end();
    } catch {
      res.status(503).json({ error: "Az üzenetet most nem sikerült törölni." });
    }
  });

  return router;
}

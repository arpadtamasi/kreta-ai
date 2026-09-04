import { Router, type Request } from "express";
import { z } from "zod";
import type { Config } from "../config.js";
import { login, revokeRefreshToken, type LoginCredentials } from "../kreta/auth.js";
import { KretaError, normalizeInstituteCode } from "../kreta/institute.js";
import type { VerifyIdToken, VerifiedUser } from "../auth/types.js";
import { connectionIsOnline, createConnection, openConnectionCredential } from "./connection.js";
import {
  ChildProfileStoreError,
  normalizeChildName,
  type ChildProfile,
  type ChildProfileStore,
} from "./store.js";
import { revokeClassroomToken } from "../classroom/auth.js";
import { classroomConnectionIsActive, openClassroomCredential } from "../classroom/connection.js";

export interface ChildProfileRouterDeps {
  store: ChildProfileStore;
  verifyIdToken: VerifyIdToken;
  config: Config;
  loginImpl?: (credentials: LoginCredentials) => ReturnType<typeof login>;
  fetchImpl?: typeof fetch;
}

const profileSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/u).optional(),
  childName: z.string().trim().min(2, "A név legyen legalább 2 karakter.").max(80, "A név legfeljebb 80 karakter lehet."),
  kretaUsername: z.string().trim().min(1, "A KRÉTA-felhasználónév kötelező.").max(120, "A KRÉTA-felhasználónév túl hosszú."),
  instituteCode: z.string().trim().min(1, "Az intézménykód kötelező.").max(200, "Az intézménykód túl hosszú."),
  password: z.string().min(1, "A KRÉTA-jelszó kötelező a kapcsolat létrehozásához.").max(512, "A KRÉTA-jelszó túl hosszú."),
  keepAlive: z.boolean().default(false),
  keepAliveUntil: z.string().datetime({ offset: true }).nullable().optional(),
});

function bearer(req: Request): string | undefined {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

function publicProfile(profile: ChildProfile) {
  const connection = profile.connection;
  const status = !connection ? "disconnected" : connectionIsOnline(connection) ? connection.state : "expired";
  const classroom = profile.classroomConnection;
  return {
    id: profile.id,
    childName: profile.childName,
    kretaUsername: profile.kretaUsername,
    instituteCode: profile.instituteCode,
    connection: {
      status,
      keepAlive: connection?.mode === "keep_alive",
      connectedAt: connection?.connectedAt ?? null,
      refreshedAt: connection?.refreshedAt ?? null,
      expiresAt: connection?.expiresAt ?? null,
      keepAliveUntil: connection?.keepAliveUntil ?? null,
    },
    classroom: {
      status: !classroom ? "disconnected" : classroomConnectionIsActive(classroom) ? "connected" : "expired",
      email: classroom?.email ?? null,
      connectedAt: classroom?.connectedAt ?? null,
      expiresAt: classroom?.expiresAt ?? null,
    },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function createChildProfileRouter(deps: ChildProfileRouterDeps): Router {
  const router = Router();
  const doLogin = deps.loginImpl ?? login;

  async function authenticated(req: Request): Promise<VerifiedUser> {
    const token = bearer(req);
    if (!token) throw new Error("missing_token");
    return deps.verifyIdToken(token);
  }

  router.get("/", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "A gyerekprofilokhoz Google-belépés szükséges." });
      return;
    }

    try {
      const profiles = await deps.store.list(user.uid);
      res.set("Cache-Control", "no-store").json({ profiles: profiles.map(publicProfile) });
    } catch {
      res.status(503).json({ error: "A gyerekprofilokat most nem sikerült betölteni." });
    }
  });

  router.put("/", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "A mentéshez Google-belépés szükséges." });
      return;
    }

    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Hibás gyerekprofil." });
      return;
    }

    let instituteCode: string;
    try {
      instituteCode = normalizeInstituteCode(parsed.data.instituteCode);
    } catch (error) {
      res.status(400).json({ error: error instanceof KretaError ? error.message : "Érvénytelen intézménykód." });
      return;
    }

    try {
      const profiles = await deps.store.list(user.uid);
      const normalizedName = normalizeChildName(parsed.data.childName);
      const duplicate = profiles.find(
        (profile) => profile.normalizedName === normalizedName && profile.id !== parsed.data.id,
      );
      if (duplicate) {
        res.status(409).json({ error: "Ezzel a névvel már van gyerekprofilod." });
        return;
      }
      if (parsed.data.id && !profiles.some((profile) => profile.id === parsed.data.id)) {
        res.status(404).json({ error: "A gyerekprofil nem található." });
        return;
      }
      if (!parsed.data.id && profiles.length >= 3) {
        res.status(409).json({ error: "Egy Google-fiókhoz legfeljebb három gyerekprofil menthető." });
        return;
      }

      const now = Date.now();
      let keepAliveUntil: string | undefined;
      if (parsed.data.keepAlive && parsed.data.keepAliveUntil) {
        const deadline = Date.parse(parsed.data.keepAliveUntil);
        if (deadline <= now || deadline > now + 366 * 24 * 60 * 60 * 1000) {
          res.status(400).json({ error: "A fenntartás határideje legyen a következő egy éven belül." });
          return;
        }
        keepAliveUntil = new Date(deadline).toISOString();
      }

      let tokens;
      try {
        tokens = await doLogin({
          username: parsed.data.kretaUsername,
          password: parsed.data.password,
          instituteCode,
        });
      } catch (error) {
        res.status(400).json({
          error: error instanceof KretaError
            ? error.message
            : "A KRÉTA-kapcsolatot nem sikerült létrehozni.",
        });
        return;
      }

      const connection = createConnection(
        deps.config.sealer,
        tokens,
        parsed.data.keepAlive ? "keep_alive" : "trial",
        keepAliveUntil,
        now,
      );
      const previousConnection = parsed.data.id
        ? profiles.find((profile) => profile.id === parsed.data.id)?.connection
        : undefined;
      let profile;
      try {
        profile = await deps.store.save(user.uid, {
          ...(parsed.data.id ? { id: parsed.data.id } : {}),
          childName: parsed.data.childName.replace(/\s+/gu, " ").trim(),
          normalizedName,
          kretaUsername: parsed.data.kretaUsername,
          instituteCode,
        }, connection);
      } catch (error) {
        await revokeRefreshToken(tokens.refreshToken, deps.fetchImpl ?? fetch);
        throw error;
      }
      if (previousConnection) {
        try {
          const previousCredential = openConnectionCredential(deps.config.sealer, previousConnection);
          await revokeRefreshToken(previousCredential.refreshToken, deps.fetchImpl ?? fetch);
        } catch {
          // The replacement connection is already safely stored.
        }
      }
      res.status(200).json({ profile: publicProfile(profile) });
    } catch (error) {
      if (error instanceof ChildProfileStoreError) {
        const messages = {
          duplicate: "Ezzel a névvel már van gyerekprofilod.",
          limit: "Egy Google-fiókhoz legfeljebb három gyerekprofil menthető.",
          not_found: "A gyerekprofil nem található.",
        } as const;
        res.status(error.code === "not_found" ? 404 : 409).json({ error: messages[error.code] });
        return;
      }
      res.status(503).json({ error: "A gyerekprofilt most nem sikerült elmenteni." });
    }
  });

  router.delete("/:id/connection", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "A kapcsolat módosításához Google-belépés szükséges." });
      return;
    }
    const id = req.params.id;
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/u.test(id)) {
      res.status(400).json({ error: "Érvénytelen gyerekprofil-azonosító." });
      return;
    }
    try {
      const profile = await deps.store.get(user.uid, id);
      if (!profile) {
        res.status(404).json({ error: "A gyerekprofil nem található." });
        return;
      }
      if (profile.connection) {
        try {
          const credential = openConnectionCredential(deps.config.sealer, profile.connection);
          await revokeRefreshToken(credential.refreshToken, deps.fetchImpl ?? fetch);
        } catch {
          // The local connection is removed even when KRÉTA is unreachable.
        }
      }
      await deps.store.clearConnection(user.uid, id);
      res.status(204).end();
    } catch {
      res.status(503).json({ error: "A kapcsolatot most nem sikerült kikapcsolni." });
    }
  });

  router.delete("/:id", async (req, res) => {
    let user: VerifiedUser;
    try {
      user = await authenticated(req);
    } catch {
      res.status(401).json({ error: "A törléshez Google-belépés szükséges." });
      return;
    }

    const id = req.params.id;
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/u.test(id)) {
      res.status(400).json({ error: "Érvénytelen gyerekprofil-azonosító." });
      return;
    }
    try {
      const profile = await deps.store.get(user.uid, id);
      if (profile?.connection) {
        try {
          const credential = openConnectionCredential(deps.config.sealer, profile.connection);
          await revokeRefreshToken(credential.refreshToken, deps.fetchImpl ?? fetch);
        } catch {
          // Expired or unreachable credentials must not prevent profile deletion.
        }
      }
      if (profile?.classroomConnection) {
        try {
          const credential = openClassroomCredential(deps.config.sealer, profile.classroomConnection);
          await revokeClassroomToken(credential.refreshToken, deps.fetchImpl ?? fetch);
        } catch {
          // An expired or unreachable Google grant must not prevent profile deletion.
        }
      }
      const deleted = await deps.store.delete(user.uid, id);
      res.status(deleted ? 204 : 404).end();
    } catch {
      res.status(503).json({ error: "A gyerekprofilt most nem sikerült törölni." });
    }
  });

  return router;
}

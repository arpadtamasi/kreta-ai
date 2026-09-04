import { Router, type Request } from "express";
import type { Sealer } from "../seal.js";
import { refreshDueConnections } from "./refresher.js";
import type { ChildProfileStore } from "./store.js";

export type VerifyRefreshJob = (token: string) => Promise<boolean>;

function bearer(req: Request): string | undefined {
  const header = req.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim() || undefined;
}

export function createConnectionRefreshRouter(deps: {
  store: ChildProfileStore;
  sealer: Sealer;
  verifyRefreshJob: VerifyRefreshJob;
  fetchImpl?: typeof fetch;
}): Router {
  const router = Router();
  router.post("/", async (req, res) => {
    const token = bearer(req);
    if (!token || !(await deps.verifyRefreshJob(token).catch(() => false))) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const result = await refreshDueConnections({
        store: deps.store,
        sealer: deps.sealer,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      });
      res.set("Cache-Control", "no-store").json(result);
    } catch {
      res.status(503).json({ error: "refresh_job_failed" });
    }
  });
  return router;
}

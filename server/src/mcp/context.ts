/**
 * Per-request tool context: resolves which connected child a call is about
 * and builds the read-only KRÉTA client for it.
 *
 * A child is addressed by the label the parent typed on the login page, so
 * "Mi van Lillának a héten?" maps to a tool call with `child: "Lilla"`. With
 * exactly one connected child the argument is optional; with several, an
 * omitted or unknown label is an error that *names the available children*,
 * because the model cannot otherwise discover them.
 */
import { KretaClient } from "../kreta/client.js";
import type { RotationCache } from "../kreta/rotationCache.js";
import type { SealedChild, SealedSession } from "../oauth/types.js";

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export function resolveChild(session: SealedSession, requested?: string): SealedChild {
  const children = session.children;
  const names = children.map((child) => child.label).join(", ");
  const wanted = requested?.trim();

  if (!wanted) {
    if (children.length === 1) return children[0]!;
    throw new ToolError(
      `Több gyerek van csatlakoztatva, add meg, melyikről kérdezel (child): ${names}.`,
    );
  }

  const match = children.find((child) => child.label.toLowerCase() === wanted.toLowerCase());
  if (!match) {
    throw new ToolError(`Nincs "${wanted}" nevű csatlakoztatott gyerek. Elérhető: ${names}.`);
  }
  return match;
}

export interface ClientFactoryDeps {
  rotationCache: RotationCache;
  fetchImpl?: typeof fetch;
}

/**
 * Builds a client for one child. The refresh token comes from the rotation
 * cache when this process has seen a newer one than the token sealed at
 * login (src/kreta/rotationCache.ts), and any rotation observed during the
 * call is written straight back.
 */
export function createClient(
  session: SealedSession,
  child: SealedChild,
  deps: ClientFactoryDeps,
): KretaClient {
  const cacheKey = `${session.sid}:${child.label.toLowerCase()}`;
  return new KretaClient({
    instituteCode: child.instituteCode,
    refreshToken: deps.rotationCache.get(cacheKey) ?? child.refreshToken,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    onRotate: (refreshToken) => deps.rotationCache.set(cacheKey, refreshToken),
  });
}

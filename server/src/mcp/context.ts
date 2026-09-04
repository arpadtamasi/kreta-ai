/**
 * Resolves a Claude tool call to one encrypted, Google-owned KRÉTA
 * connection. The OAuth token contains only profile references; the KRÉTA
 * token remains in the parent's server-side profile.
 */
import { KretaClient } from "../kreta/client.js";
import type { SealedChild, SealedSession } from "../oauth/types.js";
import { claimConnection, connectionIsOnline, openConnectionCredential, renewConnection } from "../profiles/connection.js";
import type { ChildProfileStore } from "../profiles/store.js";
import type { Sealer } from "../seal.js";
import { ClassroomClient } from "../classroom/client.js";
import { refreshClassroomAccessToken } from "../classroom/auth.js";
import { classroomConnectionIsActive, openClassroomCredential } from "../classroom/connection.js";

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
  childProfileStore: ChildProfileStore;
  sealer: Sealer;
  fetchImpl?: typeof fetch;
  classroomClientId?: string;
  classroomClientSecret?: string;
}

export async function createClassroomClient(
  session: SealedSession,
  child: SealedChild,
  deps: ClientFactoryDeps,
): Promise<ClassroomClient> {
  if (!deps.classroomClientId || !deps.classroomClientSecret) {
    throw new ToolError("A Google Classroom nincs beállítva ezen a szerveren.");
  }
  const profile = await deps.childProfileStore.get(session.uid, child.profileId);
  if (!profile?.classroomConnection || !classroomConnectionIsActive(profile.classroomConnection)) {
    throw new ToolError(`${child.label} Google Classroom-fiókja nincs összekapcsolva. Nyisd meg a kapcsolati pultot.`);
  }
  let credential;
  try {
    credential = openClassroomCredential(deps.sealer, profile.classroomConnection);
  } catch {
    throw new ToolError(`${child.label} Classroom-kapcsolata lejárt. Kapcsold össze újra a kapcsolati pulton.`);
  }
  let tokens;
  try {
    tokens = await refreshClassroomAccessToken(
      { clientId: deps.classroomClientId, clientSecret: deps.classroomClientSecret },
      credential.refreshToken,
      deps.fetchImpl ?? fetch,
    );
  } catch {
    throw new ToolError(`${child.label} Classroom-kapcsolata nem frissíthető. Kapcsold össze újra a kapcsolati pulton.`);
  }
  return new ClassroomClient(tokens.accessToken, deps.fetchImpl ?? fetch);
}

/**
 * Builds a client from the latest encrypted profile credential. Trial
 * connections may use only their initial 30-minute access token; keep-alive
 * connections persist every successful refresh with a version check.
 */
export async function createClient(
  session: SealedSession,
  child: SealedChild,
  deps: ClientFactoryDeps,
): Promise<KretaClient> {
  const profile = await deps.childProfileStore.get(session.uid, child.profileId);
  if (!profile?.connection || !connectionIsOnline(profile.connection)) {
    throw new ToolError(`${child.label} nincs online. Csatlakoztasd újra a kapcsolati pulton.`);
  }

  let credential;
  try {
    credential = openConnectionCredential(deps.sealer, profile.connection);
  } catch {
    throw new ToolError(`${child.label} kapcsolata lejárt. Csatlakoztasd újra a kapcsolati pulton.`);
  }

  let current = profile.connection;
  return new KretaClient({
    instituteCode: profile.instituteCode,
    refreshToken: credential.refreshToken,
    accessToken: credential.accessToken,
    accessExpiresAt: credential.accessExpiresAt,
    allowRefresh: current.mode === "keep_alive",
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    onBeforeRefresh: async () => {
      const claimed = claimConnection(current);
      if (!await deps.childProfileStore.updateConnection(session.uid, profile.id, current.version, claimed)) {
        throw new ToolError(`${child.label} kapcsolatát éppen másik kérés frissíti. Próbáld újra.`);
      }
      current = claimed;
    },
    onRefresh: async (tokens) => {
      const next = renewConnection(deps.sealer, current, tokens);
      if (!await deps.childProfileStore.updateConnection(session.uid, profile.id, current.version, next)) {
        throw new ToolError(`${child.label} frissített kapcsolatát nem sikerült biztonságosan elmenteni.`);
      }
      current = next;
    },
  });
}

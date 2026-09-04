import type { Sealer } from "../seal.js";
import type { ClassroomConnection } from "../profiles/store.js";

export interface StoredClassroomCredential {
  refreshToken: string;
}

export function classroomConnectionIsActive(connection: ClassroomConnection, now: number = Date.now()): boolean {
  return now < Date.parse(connection.expiresAt);
}

export function createClassroomConnection(
  sealer: Sealer,
  refreshToken: string,
  email: string,
  scopes: string[],
  ttlSeconds: number,
  now: number = Date.now(),
): ClassroomConnection {
  const expiresAt = now + ttlSeconds * 1000;
  return {
    credential: sealer.seal<StoredClassroomCredential>("classroom_credential", { refreshToken }, ttlSeconds, now),
    email,
    connectedAt: new Date(now).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    scopes: [...scopes],
  };
}

export function openClassroomCredential(
  sealer: Sealer,
  connection: ClassroomConnection,
  now: number = Date.now(),
): StoredClassroomCredential {
  if (!classroomConnectionIsActive(connection, now)) throw new Error("classroom_connection_expired");
  return sealer.open<StoredClassroomCredential>("classroom_credential", connection.credential, now);
}

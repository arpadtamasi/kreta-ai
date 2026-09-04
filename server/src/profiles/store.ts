import { createHash, randomBytes } from "node:crypto";
import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";

export type ConnectionMode = "trial" | "keep_alive";
export type ConnectionState = "active" | "attention";

export interface ChildConnection {
  /** AES-GCM sealed access + refresh token. Never returned by the HTTP API. */
  credential: string;
  mode: ConnectionMode;
  state: ConnectionState;
  connectedAt: string;
  refreshedAt: string;
  expiresAt: string;
  nextRefreshAt?: string;
  keepAliveUntil?: string;
  version: number;
  consecutiveFailures: number;
  lastErrorAt?: string;
}

export interface ClassroomConnection {
  /** AES-GCM sealed Google refresh token. Never returned by the HTTP API. */
  credential: string;
  email: string;
  connectedAt: string;
  expiresAt: string;
  scopes: string[];
}

export interface ChildProfile {
  id: string;
  childName: string;
  normalizedName: string;
  kretaUsername: string;
  instituteCode: string;
  connection?: ChildConnection;
  classroomConnection?: ClassroomConnection;
  createdAt: string;
  updatedAt: string;
}

export interface ChildProfileInput {
  childName: string;
  normalizedName: string;
  kretaUsername: string;
  instituteCode: string;
}

export interface ChildProfileStore {
  list(uid: string): Promise<ChildProfile[]>;
  get(uid: string, id: string): Promise<ChildProfile | undefined>;
  save(
    uid: string,
    input: ChildProfileInput & { id?: string },
    connection?: ChildConnection,
  ): Promise<ChildProfile>;
  updateConnection(
    uid: string,
    id: string,
    expectedVersion: number,
    connection: ChildConnection,
  ): Promise<boolean>;
  clearConnection(uid: string, id: string, expectedVersion?: number): Promise<boolean>;
  setClassroomConnection(uid: string, id: string, connection: ClassroomConnection): Promise<boolean>;
  clearClassroomConnection(uid: string, id: string): Promise<boolean>;
  listDueConnections(now: Date, limit: number): Promise<Array<{ uid: string; profile: ChildProfile }>>;
  delete(uid: string, id: string): Promise<boolean>;
}

export type ChildProfileStoreErrorCode = "duplicate" | "limit" | "not_found";

export class ChildProfileStoreError extends Error {
  constructor(readonly code: ChildProfileStoreErrorCode) {
    super(code);
    this.name = "ChildProfileStoreError";
  }
}

export function normalizeChildName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("hu-HU");
}

interface StoredProfile {
  childName?: unknown;
  normalizedName?: unknown;
  kretaUsername?: unknown;
  instituteCode?: unknown;
  connection?: unknown;
  classroomConnection?: unknown;
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
}

interface StoredConnection {
  credential?: unknown;
  mode?: unknown;
  state?: unknown;
  connectedAt?: { toDate?: () => Date };
  refreshedAt?: { toDate?: () => Date };
  expiresAt?: { toDate?: () => Date };
  nextRefreshAt?: { toDate?: () => Date };
  keepAliveUntil?: { toDate?: () => Date };
  version?: unknown;
  consecutiveFailures?: unknown;
  lastErrorAt?: { toDate?: () => Date };
}

interface StoredClassroomConnection {
  credential?: unknown;
  email?: unknown;
  connectedAt?: { toDate?: () => Date };
  expiresAt?: { toDate?: () => Date };
  scopes?: unknown;
}

function timestampToIso(value: StoredProfile["createdAt"]): string {
  const date = value?.toDate?.();
  return date instanceof Date && Number.isFinite(date.valueOf()) ? date.toISOString() : new Date(0).toISOString();
}

function optionalTimestampToIso(value: StoredConnection["nextRefreshAt"]): string | undefined {
  const date = value?.toDate?.();
  return date instanceof Date && Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

function storedConnection(value: unknown): ChildConnection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as StoredConnection;
  if (
    typeof data.credential !== "string" ||
    (data.mode !== "trial" && data.mode !== "keep_alive") ||
    (data.state !== "active" && data.state !== "attention") ||
    typeof data.version !== "number"
  ) return undefined;
  const connectedAt = optionalTimestampToIso(data.connectedAt);
  const refreshedAt = optionalTimestampToIso(data.refreshedAt);
  const expiresAt = optionalTimestampToIso(data.expiresAt);
  if (!connectedAt || !refreshedAt || !expiresAt) return undefined;
  const nextRefreshAt = optionalTimestampToIso(data.nextRefreshAt);
  const keepAliveUntil = optionalTimestampToIso(data.keepAliveUntil);
  const lastErrorAt = optionalTimestampToIso(data.lastErrorAt);
  return {
    credential: data.credential,
    mode: data.mode,
    state: data.state,
    connectedAt,
    refreshedAt,
    expiresAt,
    ...(nextRefreshAt ? { nextRefreshAt } : {}),
    ...(keepAliveUntil ? { keepAliveUntil } : {}),
    version: Math.max(1, Math.floor(data.version)),
    consecutiveFailures: typeof data.consecutiveFailures === "number"
      ? Math.max(0, Math.floor(data.consecutiveFailures))
      : 0,
    ...(lastErrorAt ? { lastErrorAt } : {}),
  };
}

function storedClassroomConnection(value: unknown): ClassroomConnection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as StoredClassroomConnection;
  const connectedAt = optionalTimestampToIso(data.connectedAt);
  const expiresAt = optionalTimestampToIso(data.expiresAt);
  if (
    typeof data.credential !== "string" ||
    typeof data.email !== "string" ||
    !connectedAt ||
    !expiresAt ||
    !Array.isArray(data.scopes) ||
    !data.scopes.every((scope): scope is string => typeof scope === "string")
  ) return undefined;
  return { credential: data.credential, email: data.email, connectedAt, expiresAt, scopes: data.scopes };
}

function firestoreConnection(connection: ChildConnection) {
  return {
    credential: connection.credential,
    mode: connection.mode,
    state: connection.state,
    connectedAt: new Date(connection.connectedAt),
    refreshedAt: new Date(connection.refreshedAt),
    expiresAt: new Date(connection.expiresAt),
    ...(connection.nextRefreshAt ? { nextRefreshAt: new Date(connection.nextRefreshAt) } : {}),
    ...(connection.keepAliveUntil ? { keepAliveUntil: new Date(connection.keepAliveUntil) } : {}),
    version: connection.version,
    consecutiveFailures: connection.consecutiveFailures,
    ...(connection.lastErrorAt ? { lastErrorAt: new Date(connection.lastErrorAt) } : {}),
  };
}

function firestoreClassroomConnection(connection: ClassroomConnection) {
  return {
    credential: connection.credential,
    email: connection.email,
    connectedAt: new Date(connection.connectedAt),
    expiresAt: new Date(connection.expiresAt),
    scopes: connection.scopes,
  };
}

function storedProfile(id: string, data: StoredProfile): ChildProfile {
  return {
    id,
    childName: typeof data.childName === "string" ? data.childName : "",
    normalizedName: typeof data.normalizedName === "string" ? data.normalizedName : "",
    kretaUsername: typeof data.kretaUsername === "string" ? data.kretaUsername : "",
    instituteCode: typeof data.instituteCode === "string" ? data.instituteCode : "",
    ...(storedConnection(data.connection) ? { connection: storedConnection(data.connection) } : {}),
    ...(storedClassroomConnection(data.classroomConnection)
      ? { classroomConnection: storedClassroomConnection(data.classroomConnection) }
      : {}),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export class FirestoreChildProfileStore implements ChildProfileStore {
  readonly #firestore: Firestore;

  constructor(firestore: Firestore) {
    this.#firestore = firestore;
  }

  #collection(uid: string) {
    return this.#firestore.collection("users").doc(uid).collection("children");
  }

  #queue() {
    return this.#firestore.collection("connectionRefreshQueue");
  }

  #queueId(uid: string, profileId: string): string {
    return createHash("sha256").update(`${uid}\0${profileId}`).digest("base64url");
  }

  #writeQueue(transaction: Transaction, uid: string, profileId: string, connection: ChildConnection): void {
    const ref = this.#queue().doc(this.#queueId(uid, profileId));
    const candidates = [
      connection.mode === "keep_alive" ? connection.nextRefreshAt : connection.expiresAt,
      connection.keepAliveUntil,
    ].filter((value): value is string => Boolean(value));
    const nextActionAt = candidates.reduce((earliest, value) =>
      Date.parse(value) < Date.parse(earliest) ? value : earliest,
    );
    transaction.set(ref, { uid, profileId, nextRefreshAt: new Date(nextActionAt) });
  }

  async list(uid: string): Promise<ChildProfile[]> {
    const snapshot = await this.#collection(uid).orderBy("createdAt", "asc").limit(12).get();
    const seen = new Set<string>();
    const profiles: ChildProfile[] = [];
    for (const doc of snapshot.docs) {
      const profile = storedProfile(doc.id, doc.data() as StoredProfile);
      if (!profile.normalizedName || seen.has(profile.normalizedName)) continue;
      seen.add(profile.normalizedName);
      profiles.push(profile);
      if (profiles.length === 3) break;
    }
    return profiles;
  }

  async get(uid: string, id: string): Promise<ChildProfile | undefined> {
    const snapshot = await this.#collection(uid).doc(id).get();
    return snapshot.exists ? storedProfile(snapshot.id, snapshot.data() as StoredProfile) : undefined;
  }

  async save(
    uid: string,
    input: ChildProfileInput & { id?: string },
    connection?: ChildConnection,
  ): Promise<ChildProfile> {
    const collection = this.#collection(uid);
    const ref = input.id ? collection.doc(input.id) : collection.doc(randomBytes(12).toString("base64url"));
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(collection.orderBy("createdAt", "asc").limit(12));
      const existing = snapshot.docs.map((doc) => storedProfile(doc.id, doc.data() as StoredProfile));
      const previous = existing.find((profile) => profile.id === input.id);

      if (input.id && !previous) throw new ChildProfileStoreError("not_found");
      if (existing.some((profile) => profile.normalizedName === input.normalizedName && profile.id !== input.id)) {
        throw new ChildProfileStoreError("duplicate");
      }
      if (!input.id && existing.length >= 3) throw new ChildProfileStoreError("limit");

      const now = new Date();
      const createdAt = previous?.createdAt ?? now.toISOString();
      const savedConnection = connection ?? previous?.connection;
      const classroomConnection = previous?.classroomConnection;
      transaction.set(ref, {
        childName: input.childName,
        normalizedName: input.normalizedName,
        kretaUsername: input.kretaUsername,
        instituteCode: input.instituteCode,
        ...(savedConnection ? { connection: firestoreConnection(savedConnection) } : {}),
        ...(classroomConnection ? { classroomConnection: firestoreClassroomConnection(classroomConnection) } : {}),
        createdAt: new Date(createdAt),
        updatedAt: now,
      });
      if (savedConnection) this.#writeQueue(transaction, uid, ref.id, savedConnection);

      return {
        id: ref.id,
        childName: input.childName,
        normalizedName: input.normalizedName,
        kretaUsername: input.kretaUsername,
        instituteCode: input.instituteCode,
        ...(savedConnection ? { connection: savedConnection } : {}),
        ...(classroomConnection ? { classroomConnection } : {}),
        createdAt,
        updatedAt: now.toISOString(),
      };
    });
  }

  async updateConnection(
    uid: string,
    id: string,
    expectedVersion: number,
    connection: ChildConnection,
  ): Promise<boolean> {
    const ref = this.#collection(uid).doc(id);
    return this.#firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const profile = storedProfile(snapshot.id, snapshot.data() as StoredProfile);
      if (!profile.connection || profile.connection.version !== expectedVersion) return false;
      transaction.update(ref, { connection: firestoreConnection(connection), updatedAt: new Date() });
      this.#writeQueue(transaction, uid, id, connection);
      return true;
    });
  }

  async listDueConnections(now: Date, limit: number): Promise<Array<{ uid: string; profile: ChildProfile }>> {
    const queue = await this.#queue()
      .where("nextRefreshAt", "<=", now)
      .orderBy("nextRefreshAt", "asc")
      .limit(limit)
      .get();
    const due: Array<{ uid: string; profile: ChildProfile }> = [];
    for (const item of queue.docs) {
      const data = item.data() as { uid?: unknown; profileId?: unknown };
      if (typeof data.uid !== "string" || typeof data.profileId !== "string") continue;
      const profile = await this.get(data.uid, data.profileId);
      if (!profile?.connection) continue;
      due.push({ uid: data.uid, profile });
    }
    return due;
  }

  async clearConnection(uid: string, id: string, expectedVersion?: number): Promise<boolean> {
    const ref = this.#collection(uid).doc(id);
    return this.#firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) return false;
      if (expectedVersion !== undefined) {
        const profile = storedProfile(existing.id, existing.data() as StoredProfile);
        if (profile.connection?.version !== expectedVersion) return false;
      }
      transaction.update(ref, { connection: FieldValue.delete(), updatedAt: new Date() });
      transaction.delete(this.#queue().doc(this.#queueId(uid, id)));
      return true;
    });
  }

  async setClassroomConnection(uid: string, id: string, connection: ClassroomConnection): Promise<boolean> {
    const ref = this.#collection(uid).doc(id);
    return this.#firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) return false;
      transaction.update(ref, {
        classroomConnection: firestoreClassroomConnection(connection),
        updatedAt: new Date(),
      });
      return true;
    });
  }

  async clearClassroomConnection(uid: string, id: string): Promise<boolean> {
    const ref = this.#collection(uid).doc(id);
    return this.#firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) return false;
      transaction.update(ref, { classroomConnection: FieldValue.delete(), updatedAt: new Date() });
      return true;
    });
  }

  async delete(uid: string, id: string): Promise<boolean> {
    const ref = this.#collection(uid).doc(id);
    return this.#firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (!existing.exists) return false;
      transaction.delete(ref);
      transaction.delete(this.#queue().doc(this.#queueId(uid, id)));
      return true;
    });
  }
}

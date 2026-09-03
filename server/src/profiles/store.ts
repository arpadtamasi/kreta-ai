import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";

export interface ChildProfile {
  id: string;
  childName: string;
  normalizedName: string;
  kretaUsername: string;
  instituteCode: string;
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
  save(uid: string, input: ChildProfileInput & { id?: string }): Promise<ChildProfile>;
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
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
}

function timestampToIso(value: StoredProfile["createdAt"]): string {
  const date = value?.toDate?.();
  return date instanceof Date && Number.isFinite(date.valueOf()) ? date.toISOString() : new Date(0).toISOString();
}

function storedProfile(id: string, data: StoredProfile): ChildProfile {
  return {
    id,
    childName: typeof data.childName === "string" ? data.childName : "",
    normalizedName: typeof data.normalizedName === "string" ? data.normalizedName : "",
    kretaUsername: typeof data.kretaUsername === "string" ? data.kretaUsername : "",
    instituteCode: typeof data.instituteCode === "string" ? data.instituteCode : "",
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

  async save(uid: string, input: ChildProfileInput & { id?: string }): Promise<ChildProfile> {
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
      transaction.set(ref, {
        childName: input.childName,
        normalizedName: input.normalizedName,
        kretaUsername: input.kretaUsername,
        instituteCode: input.instituteCode,
        createdAt: new Date(createdAt),
        updatedAt: now,
      });

      return {
        id: ref.id,
        childName: input.childName,
        normalizedName: input.normalizedName,
        kretaUsername: input.kretaUsername,
        instituteCode: input.instituteCode,
        createdAt,
        updatedAt: now.toISOString(),
      };
    });
  }

  async delete(uid: string, id: string): Promise<boolean> {
    const ref = this.#collection(uid).doc(id);
    const existing = await ref.get();
    if (!existing.exists) return false;
    await ref.delete();
    return true;
  }
}

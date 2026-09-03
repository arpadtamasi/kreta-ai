import type { Firestore } from "firebase-admin/firestore";

export interface Pledge {
  uid: string;
  name: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface PledgeStore {
  list(limit: number): Promise<{ count: number; pledges: Pledge[] }>;
  upsert(input: { uid: string; name: string; message: string }): Promise<Pledge>;
  delete(uid: string): Promise<boolean>;
}

interface StoredPledge {
  name?: unknown;
  message?: unknown;
  createdAt?: { toDate?: () => Date };
  updatedAt?: { toDate?: () => Date };
}

function timestampToIso(value: StoredPledge["createdAt"]): string {
  const date = value?.toDate?.();
  return date instanceof Date && Number.isFinite(date.valueOf()) ? date.toISOString() : new Date(0).toISOString();
}

export class FirestorePledgeStore implements PledgeStore {
  readonly #collection;

  constructor(firestore: Firestore) {
    this.#collection = firestore.collection("pledges");
  }

  async list(limit: number): Promise<{ count: number; pledges: Pledge[] }> {
    const [countSnapshot, listSnapshot] = await Promise.all([
      this.#collection.count().get(),
      this.#collection.orderBy("updatedAt", "desc").limit(limit).get(),
    ]);

    return {
      count: countSnapshot.data().count,
      pledges: listSnapshot.docs.map((doc) => {
        const data = doc.data() as StoredPledge;
        return {
          uid: doc.id,
          name: typeof data.name === "string" ? data.name : "Névtelen támogató",
          message: typeof data.message === "string" ? data.message : "",
          createdAt: timestampToIso(data.createdAt),
          updatedAt: timestampToIso(data.updatedAt),
        };
      }),
    };
  }

  async upsert(input: { uid: string; name: string; message: string }): Promise<Pledge> {
    const ref = this.#collection.doc(input.uid);
    const now = new Date();
    const previous = await ref.get();
    const previousData = previous.data() as StoredPledge | undefined;
    const createdAt = previous.exists ? timestampToIso(previousData?.createdAt) : now.toISOString();

    await ref.set({
      name: input.name,
      message: input.message,
      createdAt: new Date(createdAt),
      updatedAt: now,
    });

    return { ...input, createdAt, updatedAt: now.toISOString() };
  }

  async delete(uid: string): Promise<boolean> {
    const ref = this.#collection.doc(uid);
    const existing = await ref.get();
    if (!existing.exists) return false;
    await ref.delete();
    return true;
  }
}

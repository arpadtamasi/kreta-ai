import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { createConnection, nextRefreshDelayMs, openConnectionCredential } from "../src/profiles/connection.js";
import { refreshDueConnections } from "../src/profiles/refresher.js";
import type { ChildConnection, ChildProfile, ChildProfileInput, ChildProfileStore, ClassroomConnection } from "../src/profiles/store.js";
import { Sealer } from "../src/seal.js";

const sealer = new Sealer(randomBytes(32));
const tokenPair = (suffix: string) => ({
  accessToken: `access-${suffix}`,
  refreshToken: `refresh-${suffix}`,
  expiresIn: 1800,
  rotated: true,
});

class MemoryStore implements ChildProfileStore {
  connection: ChildConnection | undefined;

  constructor(connection: ChildConnection) {
    this.connection = connection;
  }

  private profile(): ChildProfile {
    return {
      id: "profile-lilla",
      childName: "Lilla",
      normalizedName: "lilla",
      kretaUsername: "lilla-user",
      instituteCode: "klik123456",
      ...(this.connection ? { connection: this.connection } : {}),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  }

  async list() { return [this.profile()]; }
  async get() { return this.profile(); }
  async save(_uid: string, _input: ChildProfileInput & { id?: string }, connection?: ChildConnection) {
    this.connection = connection;
    return this.profile();
  }
  async updateConnection(_uid: string, _id: string, expectedVersion: number, connection: ChildConnection) {
    if (!this.connection || this.connection.version !== expectedVersion) return false;
    this.connection = connection;
    return true;
  }
  async clearConnection() {
    this.connection = undefined;
    return true;
  }
  async setClassroomConnection(_uid: string, _id: string, _connection: ClassroomConnection) { return false; }
  async clearClassroomConnection() { return false; }
  async listDueConnections(now: Date) {
    if (!this.connection) return [];
    const dueAt = this.connection.mode === "keep_alive"
      ? this.connection.nextRefreshAt
      : this.connection.expiresAt;
    return dueAt && Date.parse(dueAt) <= now.valueOf()
      ? [{ uid: "parent-uid", profile: this.profile() }]
      : [];
  }
  async delete() { return false; }
}

test("a due keep-alive connection rotates and stores the new encrypted token", async () => {
  const now = Date.now();
  const store = new MemoryStore(createConnection(sealer, tokenPair("old"), "keep_alive", undefined, now - 26 * 60_000));
  const result = await refreshDueConnections({
    store,
    sealer,
    now,
    refreshImpl: async (refreshToken) => {
      assert.equal(refreshToken, "refresh-old");
      return tokenPair("new");
    },
  });

  assert.deepEqual(result, { due: 1, refreshed: 1, conflicted: 0, failed: 0, expired: 0, ended: 0 });
  assert.equal(store.connection?.version, 3);
  assert.equal(store.connection?.state, "active");
  assert.equal(openConnectionCredential(sealer, store.connection!, now).refreshToken, "refresh-new");
  const scheduled = Date.parse(store.connection!.nextRefreshAt!) - now;
  assert.ok(
    scheduled > 21 * 60_000 && scheduled <= 25 * 60_000,
    `the next refresh stays under the 25-minute ceiling, jittered: ${scheduled}ms`,
  );
});

test("refreshes are spread out, so connections made together do not pile onto one run", () => {
  const delays = new Set([0.01, 0.25, 0.5, 0.99].map((value) => nextRefreshDelayMs(() => value)));
  assert.equal(delays.size, 4, "different draws must land on different minutes");
  for (const delay of delays) {
    assert.ok(delay > 21 * 60_000, "never so early that the rotation burns tokens for nothing");
    assert.ok(delay <= 25 * 60_000, "never later than the current ceiling: the access token lives 30 minutes");
  }
  assert.equal(nextRefreshDelayMs(() => 0), 25 * 60_000, "an unjittered draw keeps the documented interval");
});

test("two overlapping workers never present the same single-use refresh token twice", async () => {
  const now = Date.now();
  const store = new MemoryStore(createConnection(sealer, tokenPair("old"), "keep_alive", undefined, now - 26 * 60_000));
  let refreshCalls = 0;
  const run = () => refreshDueConnections({
    store,
    sealer,
    now,
    refreshImpl: async () => {
      refreshCalls += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      return tokenPair("new");
    },
  });

  const results = await Promise.all([run(), run()]);
  assert.equal(refreshCalls, 1);
  assert.equal(results.reduce((sum, result) => sum + result.refreshed, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.conflicted, 0), 1);
});

test("a refresh failure marks the connection for a bounded retry", async () => {
  const now = Date.now();
  const store = new MemoryStore(createConnection(sealer, tokenPair("old"), "keep_alive", undefined, now - 26 * 60_000));
  const result = await refreshDueConnections({
    store,
    sealer,
    now,
    refreshImpl: async () => { throw new Error("upstream details must stay private"); },
  });

  assert.equal(result.failed, 1);
  assert.equal(store.connection?.state, "attention");
  assert.equal(store.connection?.consecutiveFailures, 1);
  assert.equal(Date.parse(store.connection!.nextRefreshAt!), now + 5 * 60_000);
});

test("the worker removes trial credentials at 30 minutes", async () => {
  const now = Date.now();
  const store = new MemoryStore(createConnection(sealer, tokenPair("trial"), "trial", undefined, now - 31 * 60_000));
  const result = await refreshDueConnections({ store, sealer, now });

  assert.equal(result.expired, 1);
  assert.equal(store.connection, undefined);
});

test("an optional keep-alive deadline turns the child Offline", async () => {
  const now = Date.now();
  const store = new MemoryStore(createConnection(
    sealer,
    tokenPair("old"),
    "keep_alive",
    new Date(now - 1).toISOString(),
    now - 26 * 60_000,
  ));
  const result = await refreshDueConnections({ store, sealer, now });

  assert.equal(result.ended, 1);
  assert.equal(store.connection, undefined);
});

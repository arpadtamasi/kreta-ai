import assert from "node:assert/strict";
import { test } from "node:test";
import { LoginThrottle } from "../src/profiles/loginThrottle.js";

test("nyolc hibás próbálkozás után zár, sikerre nyit", () => {
  let now = 1_000_000;
  const throttle = new LoginThrottle(() => now);
  const key = "uid:klik034802001";

  for (let i = 0; i < 8; i += 1) {
    assert.equal(throttle.retryAfter(key), 0, `a ${i + 1}. próba még mehet`);
    throttle.recordFailure(key);
  }

  const retryAfter = throttle.retryAfter(key);
  assert.ok(retryAfter > 0 && retryAfter <= 900, `zárva kell lennie, kapott: ${retryAfter}`);

  now += 15 * 60 * 1000 + 1;
  assert.equal(throttle.retryAfter(key), 0, "az ablak lejárta után újra mehet");
});

test("a sikeres belépés törli a számlálót", () => {
  const throttle = new LoginThrottle(() => 5_000);
  const key = "uid:klik034802001";
  for (let i = 0; i < 8; i += 1) throttle.recordFailure(key);
  assert.ok(throttle.retryAfter(key) > 0);
  throttle.clear(key);
  assert.equal(throttle.retryAfter(key), 0);
});

test("a fiókok nem korlátozzák egymást", () => {
  const throttle = new LoginThrottle(() => 5_000);
  for (let i = 0; i < 8; i += 1) throttle.recordFailure("a:i1");
  assert.ok(throttle.retryAfter("a:i1") > 0);
  assert.equal(throttle.retryAfter("b:i1"), 0);
});

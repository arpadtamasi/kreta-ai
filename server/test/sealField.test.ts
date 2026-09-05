import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { Sealer } from "../src/seal.js";

const sealer = new Sealer(randomBytes(32));

test("a pecsételt mező visszaolvasható, de nem tartalmazza a nyílt értéket", () => {
  const value = "Lilla Példa";
  const sealed = sealer.sealField(value);
  assert.notEqual(sealed, value);
  assert.ok(!sealed.includes("Lilla"), "a nyílt név nem látszhat a tárolt értékben");
  assert.equal(sealer.openField(sealed), value);
});

test("másik kulccsal nem nyitható", () => {
  const sealed = sealer.sealField("klik034802001");
  const other = new Sealer(randomBytes(32));
  assert.throws(() => other.openField(sealed));
});

test("más célra pecsételt érték nem nyitható mezőként", () => {
  const credential = sealer.seal("credential", "titok", 60_000);
  assert.throws(() => sealer.openField(credential));
});

test("az ujjlenyomat determinisztikus és nem fordítható vissza", () => {
  const a = sealer.fingerprint("lilla példa");
  assert.equal(a, sealer.fingerprint("lilla példa"));
  assert.notEqual(a, sealer.fingerprint("benedek példa"));
  assert.ok(!a.includes("lilla"));
});

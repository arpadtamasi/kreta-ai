#!/usr/bin/env node
/**
 * Éles smoke-teszt a Node-porthoz (a kreta_smoke_test.py megfelelője):
 * belépés PKCE-vel, TanulóAdatlap-olvasás, refresh token visszavonása.
 *
 * A hitelesítő adatokat a repo-gyökér .env fájljából olvassa (egygyerekes
 * formátum: KRETA_USERNAME / KRETA_PASSWORD / KRETA_INSTITUTE_CODE).
 * Értéket, tokent, adatot nem ír ki.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeInstituteCode } from "../server/config.js";
import { KretaClient } from "../server/kreta-client.js";

// Minimális .env-olvasó: KEY=érték sorok, idézőjelek levágása,
// behelyettesítés nélkül (a ${...} nyers adat marad — l. interpolate=False).
function loadEnvFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
    }
    values[match[1]] = value;
  }
  return values;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = loadEnvFile(join(repoRoot, ".env"));
const credentials = {
  label: env.KRETA_LABEL ?? "",
  username: (env.KRETA_USERNAME ?? "").trim(),
  password: env.KRETA_PASSWORD ?? "",
  instituteCode: normalizeInstituteCode(env.KRETA_INSTITUTE_CODE ?? ""),
};
if (!credentials.username || !credentials.password) {
  console.error("HIBA: hiányzó KRETA_USERNAME/KRETA_PASSWORD a .env-ben.");
  process.exit(1);
}

const client = new KretaClient(credentials);
try {
  console.log("1/3 KRÉTA bejelentkezés ellenőrzése…");
  await client.authenticate();
  console.log("2/3 TanulóAdatlap olvasási próba…");
  const profile = await client.getJson("sajat/TanuloAdatlap");
  if (!profile || typeof profile !== "object") {
    throw new Error("A TanulóAdatlap végpont nem adott objektumot.");
  }
  console.log("3/3 Refresh token visszavonása…");
  await client.close();
  console.log("SIKER: a bejelentkezés és az olvasási API-kérés működik.");
} catch (error) {
  await client.close().catch(() => {});
  console.error(`HIBA: ${error.message}`);
  process.exit(1);
}

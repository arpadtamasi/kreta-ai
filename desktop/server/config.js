/**
 * Gyerekenkénti hitelesítő adatok beolvasása környezeti változókból.
 *
 * A Claude Desktop a manifest user_config mezőit KRETA_CHILD<n>_* változókként
 * adja át (1. gyerek kötelező, a többi üresen hagyható). A jelszó a Desktop
 * kulcstartójából érkezik, ez a folyamat sehová nem írja ki.
 */

import { KretaError } from "./kreta-auth.js";

const INSTITUTE_CODE_PATTERN = /^[A-Za-z0-9-]{2,40}$/;
const MAX_CHILDREN = 9;

/** Az intézménykód normalizálása: URL-ből vagy hostnévből is a rövid kód lesz. */
export function normalizeInstituteCode(value) {
  let candidate = value.trim().replace(/\/+$/, "");
  if (candidate.includes("://")) {
    try {
      candidate = new URL(candidate).hostname ?? "";
    } catch {
      candidate = "";
    }
  } else {
    candidate = candidate.split("/", 1)[0];
  }
  const suffix = ".e-kreta.hu";
  if (candidate.toLowerCase().endsWith(suffix)) {
    candidate = candidate.slice(0, -suffix.length);
  }
  if (!INSTITUTE_CODE_PATTERN.test(candidate)) {
    throw new KretaError(
      "Az intézménykód mezőbe az iskola rövid kódját vagy a " +
        "https://<kód>.e-kreta.hu címet írd.",
    );
  }
  return candidate;
}

/**
 * A beállított gyerekek listája: {label, username, password, instituteCode}.
 * Egy kitöltetlen mezőcsoport (minden mezője üres) egyszerűen kimarad;
 * félig kitöltött csoportra érthető hibát ad.
 */
export function loadChildren(env = process.env) {
  const children = [];
  const seen = new Set();
  // Kitöltetlen mező helyén a behelyettesítetlen "${user_config.*}" minta is
  // előfordulhat — azt üresként kezeljük.
  const read = (name) => {
    const value = env[name] ?? "";
    return value.includes("${user_config.") ? "" : value;
  };
  for (let slot = 1; slot <= MAX_CHILDREN; slot += 1) {
    const prefix = `KRETA_CHILD${slot}_`;
    const label = read(`${prefix}NAME`).trim();
    const username = read(`${prefix}USERNAME`).trim();
    const password = read(`${prefix}PASSWORD`);
    const rawCode = read(`${prefix}INSTITUTE_CODE`).trim();
    const values = [label, username, password.trim(), rawCode];
    if (values.every((v) => !v)) continue;
    if (values.some((v) => !v)) {
      throw new KretaError(
        `A(z) ${slot}. gyerek adatai hiányosak${label ? ` (${label})` : ""} — ` +
          "a név, a KRÉTA-felhasználónév, a jelszó és az intézménykód " +
          "mindegyike kell. A bővítmény beállításainál pótolhatod.",
      );
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      throw new KretaError(`Kétszer szerepel ugyanaz a gyerek-név: ${label}.`);
    }
    seen.add(key);
    children.push({
      label,
      username,
      password,
      instituteCode: normalizeInstituteCode(rawCode),
    });
  }
  if (!children.length) {
    throw new KretaError(
      "Még nincs beállítva egy gyerek sem. Nyisd meg a KRÉTA bővítmény " +
        "beállításait (Settings → Extensions → KRÉTA), és add meg az első " +
        "gyerek adatait.",
    );
  }
  return children;
}

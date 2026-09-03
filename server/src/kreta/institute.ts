/** Institute-code normalization, ported from python/kreta_smoke_test.py. */

const INSTITUTE_CODE_PATTERN = /^[A-Za-z0-9-]{2,40}$/;

export class KretaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KretaError";
  }
}

/**
 * Accepts the bare code, `kod.e-kreta.hu`, or `https://kod.e-kreta.hu` —
 * parents copy whichever of the three they happen to have in front of them.
 */
export function normalizeInstituteCode(value: string): string {
  let candidate = value.trim().replace(/\/+$/, "");
  if (candidate.includes("://")) {
    let hostname = "";
    try {
      hostname = new URL(candidate).hostname;
    } catch {
      hostname = "";
    }
    candidate = hostname;
  } else {
    candidate = candidate.split("/", 1)[0] ?? "";
  }

  const suffix = ".e-kreta.hu";
  if (candidate.toLowerCase().endsWith(suffix)) {
    candidate = candidate.slice(0, -suffix.length);
  }

  if (!INSTITUTE_CODE_PATTERN.test(candidate)) {
    throw new KretaError(
      "Az intézménykód mezőbe az iskola rövid kódját vagy a https://<kód>.e-kreta.hu címet írd.",
    );
  }
  return candidate;
}

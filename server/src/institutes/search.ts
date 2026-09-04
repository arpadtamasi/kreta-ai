import { KretaError, normalizeInstituteCode } from "../kreta/institute.js";

const INSTITUTE_SELECTOR_URL = "https://intezmenykereso.e-kreta.hu/instituteSelector";
const MAX_RESPONSE_BYTES = 512_000;
const MAX_RESULTS = 20;

export interface InstituteSuggestion {
  code: string;
  name: string;
}

export type InstituteSearch = (query: string) => Promise<InstituteSuggestion[]>;

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|quot);/giu, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const codePoint = Number.parseInt(body.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    if (body.startsWith("#")) {
      const codePoint = Number.parseInt(body.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

function cleanLabel(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function nameFromLabel(label: string, code: string): string {
  const suffixStart = label.toLocaleLowerCase("hu-HU").lastIndexOf(` (${code.toLocaleLowerCase("hu-HU")}`);
  return suffixStart > 0 ? label.slice(0, suffixStart).trim() : label;
}

export function parseInstituteSelector(html: string): InstituteSuggestion[] {
  const suggestions: InstituteSuggestion[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a\b[^>]*\bdata-val=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/giu;

  for (const match of html.matchAll(linkPattern)) {
    let code: string;
    try {
      code = normalizeInstituteCode(decodeHtml(match[2] ?? ""));
    } catch (error) {
      if (error instanceof KretaError) continue;
      throw error;
    }

    const normalizedCode = code.toLocaleLowerCase("hu-HU");
    if (seen.has(normalizedCode)) continue;
    const label = cleanLabel(match[3] ?? "");
    const name = nameFromLabel(label, code);
    if (!name) continue;

    seen.add(normalizedCode);
    suggestions.push({ code, name });
    if (suggestions.length === MAX_RESULTS) break;
  }

  return suggestions;
}

export async function searchKretaInstitutes(
  rawQuery: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstituteSuggestion[]> {
  const query = rawQuery.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const response = await fetchImpl(
    `${INSTITUTE_SELECTOR_URL}/${encodeURIComponent(query)}?showOnlyLive=true`,
    {
      headers: {
        accept: "text/html;charset=UTF-8",
        "user-agent": "Uzenofuzet/0.1 institution-search",
      },
      signal: AbortSignal.timeout(5_000),
    },
  );

  if (!response.ok) throw new Error(`institution_search_${response.status}`);
  const declaredSize = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
    throw new Error("institution_search_response_too_large");
  }

  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("institution_search_response_too_large");
  }
  return parseInstituteSelector(html);
}

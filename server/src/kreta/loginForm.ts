/**
 * Minimal extractor for the KRÉTA IDP login form.
 *
 * The Python client uses BeautifulSoup for this; pulling a full HTML parser
 * into the server for one ASP.NET form would be a heavier dependency than
 * the job needs, so this reads exactly what the login POST requires: the
 * form's action and its input elements (crucially the anti-forgery token and
 * `ReturnUrl`, which the IDP rejects the submission without).
 *
 * Deliberately strict: if the page shape changes enough that no POST form or
 * no action is found, callers surface a clear "the login page changed" error
 * rather than silently posting a credential into a request that cannot work.
 */
export interface LoginForm {
  action: string;
  fields: Record<string, string>;
}

const FORM_RE = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const INPUT_RE = /<input\b([^>]*?)\/?>/gi;

function readAttribute(tag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const match = pattern.exec(tag);
  if (!match) return undefined;
  return match[2] ?? match[3] ?? match[4] ?? "";
}

/** Decodes the entity subset an ASP.NET-rendered attribute value can contain. */
function decodeEntities(value: string): string {
  return value
    .replace(/&(?:amp|AMP);/g, "&")
    .replace(/&(?:lt|LT);/g, "<")
    .replace(/&(?:gt|GT);/g, ">")
    .replace(/&(?:quot|QUOT);/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(?:apos|#39);/g, "'");
}

export function parseLoginForm(html: string): LoginForm | null {
  FORM_RE.lastIndex = 0;
  for (let form = FORM_RE.exec(html); form !== null; form = FORM_RE.exec(html)) {
    const attributes = form[1] ?? "";
    const method = readAttribute(attributes, "method");
    if (!method || method.toLowerCase() !== "post") continue;

    const action = readAttribute(attributes, "action");
    if (!action) continue;

    const fields: Record<string, string> = {};
    const body = form[2] ?? "";
    INPUT_RE.lastIndex = 0;
    for (let input = INPUT_RE.exec(body); input !== null; input = INPUT_RE.exec(body)) {
      const inputAttributes = input[1] ?? "";
      const name = readAttribute(inputAttributes, "name");
      if (!name) continue;
      fields[decodeEntities(name)] = decodeEntities(readAttribute(inputAttributes, "value") ?? "");
    }
    return { action: decodeEntities(action), fields };
  }
  return null;
}

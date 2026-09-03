/**
 * The one page this service renders: the KRÉTA login form that /authorize
 * serves to the parent's browser.
 *
 * This form is the whole reason the product can have a one-click connect
 * UX without holding a password. It is also, structurally, a third-party
 * page asking for a school credential — so it says so, in plain Hungarian,
 * above the fold rather than in a footer. Do not soften that copy.
 */
import { BRAND } from "../brand.js";
import { escapeHtml } from "../htmlEscape.js";

export const LOGIN_PAGE_STYLE = `
  :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f4f5f7; color: #14181f; }
  main { width: min(100%, 34rem); background: #fff; border: 1px solid #dde1e7; border-radius: 18px; padding: clamp(24px, 5vw, 40px); box-shadow: 0 18px 46px -32px rgb(20 24 31 / 45%); }
  .mark { margin: 0 0 4px; font-weight: 800; letter-spacing: -.03em; font-size: 1.05rem; }
  .tagline { margin: 0 0 24px; color: #626b78; font-size: .9rem; }
  h1 { margin: 0 0 12px; font-size: 1.5rem; letter-spacing: -.02em; }
  p { line-height: 1.5; }
  .notice { margin: 0 0 24px; padding: 14px 16px; border: 1px solid #f0d9a8; border-radius: 10px; background: #fdf7ea; font-size: .88rem; line-height: 1.5; color: #4a3c1d; }
  .notice strong { display: block; margin-bottom: 4px; }
  fieldset { margin: 0 0 16px; padding: 18px; border: 1px solid #dde1e7; border-radius: 12px; }
  legend { padding: 0 6px; font-weight: 700; font-size: .85rem; color: #404854; }
  label { display: block; margin-bottom: 12px; font-size: .85rem; font-weight: 600; color: #404854; }
  label:last-child { margin-bottom: 0; }
  input { display: block; width: 100%; margin-top: 5px; min-height: 42px; padding: 0 12px; border: 1px solid #c3cad4; border-radius: 8px; font: inherit; background: #fff; color: inherit; }
  input:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid rgb(26 115 232 / 38%); outline-offset: 2px; }
  .hint { font-weight: 400; color: #77808d; }
  button { min-height: 44px; border: 0; border-radius: 8px; font: inherit; font-weight: 700; cursor: pointer; }
  .primary { width: 100%; background: #1a56db; color: #fff; }
  .secondary { width: 100%; margin-bottom: 16px; background: #eef1f6; color: #2a3140; }
  .error { margin: 0 0 20px; padding: 14px 16px; border: 1px solid #f0bcb6; border-radius: 10px; background: #fdeeec; color: #8c221a; font-size: .9rem; line-height: 1.5; }
  footer { margin-top: 24px; color: #77808d; font-size: .75rem; line-height: 1.5; }
`;

export const LOGIN_PAGE_SCRIPT = `
  const add = document.getElementById("add");
  add?.addEventListener("click", () => {
    const next = document.querySelector("fieldset.extra[hidden]");
    if (!next) return;
    next.hidden = false;
    next.disabled = false;
    for (const input of next.querySelectorAll("input")) input.required = true;
    if (!document.querySelector("fieldset.extra[hidden]")) add.hidden = true;
    next.querySelector("input")?.focus();
  });
`;

function childFieldset(index: number, legend: string): string {
  const optional = index > 0;
  return `
<fieldset${optional ? ' class="extra" hidden disabled' : ""}>
  <legend>${escapeHtml(legend)}</legend>
  <label>Név <span class="hint">— ahogy Claude-ban hivatkozol rá</span>
    <input name="label" type="text" autocomplete="off" ${optional ? "" : "required"} placeholder="pl. Lilla"></label>
  <label>KRÉTA felhasználónév
    <input name="username" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" ${optional ? "" : "required"}></label>
  <label>KRÉTA jelszó
    <input name="password" type="password" autocomplete="off" ${optional ? "" : "required"}></label>
  <label>Intézménykód <span class="hint">— pl. klik123456 vagy https://klik123456.e-kreta.hu</span>
    <input name="instituteCode" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" ${optional ? "" : "required"}></label>
</fieldset>`;
}

export interface LoginPageParams {
  /** Opaque, sealed continuation of the in-flight authorization request. */
  request: string;
  clientName: string | undefined;
  error?: string | undefined;
}

export function renderLoginPage(params: LoginPageParams): string {
  const client = params.clientName?.trim() || "egy MCP-kliens";
  const error = params.error
    ? `<p class="error" role="alert">${escapeHtml(params.error)}</p>`
    : "";

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>Bejelentkezés — ${escapeHtml(BRAND.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/authorize.css">
</head>
<body>
<main>
<p class="mark">${escapeHtml(BRAND.name)}</p>
<p class="tagline">${escapeHtml(BRAND.tagline)}</p>
<h1>Csatlakoztatás: ${escapeHtml(client)}</h1>
${error}
<p class="notice">
  <strong>Ez nem a KRÉTA oldala.</strong>
  A ${escapeHtml(BRAND.name)} szervere jelentkezik be helyetted a KRÉTA-ba, és utána
  csak a kapott belépési jogosultságot tartja meg — <b>a jelszavadat nem tárolja
  sehol</b>, se adatbázisban, se naplóban. Ha ez nem elég neked, ne itt add meg:
  a projekt helyben futó változata a saját gépeden marad.
</p>
<form method="post" action="/authorize/login" autocomplete="off">
  <input type="hidden" name="request" value="${escapeHtml(params.request)}">
  ${childFieldset(0, "Gyerek")}
  ${childFieldset(1, "2. gyerek")}
  ${childFieldset(2, "3. gyerek")}
  <button type="button" class="secondary" id="add">+ Még egy gyerek</button>
  <button type="submit" class="primary">Csatlakoztatás</button>
</form>
<footer>
  ${escapeHtml(BRAND.disclaimer)}
  Csak olvasás: a kapcsolat semmit nem módosít és nem töröl a KRÉTA-ban.
</footer>
</main>
<script src="/authorize.js" defer></script>
</body>
</html>`;
}

/** Terminal page for a failure that cannot be sent back to the client as a redirect. */
export function renderErrorPage(title: string, detail: string): string {
  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — ${escapeHtml(BRAND.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/authorize.css">
</head>
<body>
<main>
<p class="mark">${escapeHtml(BRAND.name)}</p>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(detail)}</p>
<footer>${escapeHtml(BRAND.disclaimer)}</footer>
</main>
</body>
</html>`;
}

/**
 * The credential page served during OAuth. The parent is already identified
 * by a Google-backed session, so the password manager sees each child as an
 * ordinary username/password pair: real name plus transient KRÉTA password.
 */
import { BRAND } from "../brand.js";
import { escapeHtml } from "../htmlEscape.js";
import type { ChildProfile } from "../profiles/store.js";

export const LOGIN_PAGE_STYLE = `
  :root { color-scheme: light; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #14181f; background: #eef2f7; }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; min-width: 320px; min-height: 100vh; padding: clamp(18px, 4vw, 48px); background: #eef2f7; }
  body::before { content: ""; position: fixed; inset: 0 0 auto; height: 6px; background: #073896; }
  main { width: min(100%, 42rem); margin: 0 auto; overflow: hidden; border-radius: 18px; background: #fff; box-shadow: 0 24px 70px -42px rgb(8 23 43 / 60%); }
  .head { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: center; padding: 26px clamp(22px, 5vw, 40px) 22px; border-bottom: 1px solid #d9e1ec; }
  .book { position: relative; width: 38px; height: 38px; border: 2px solid #113f7a; }
  .book::before, .book::after { content: ""; position: absolute; top: 8px; bottom: 8px; width: 11px; border: 1.5px solid #113f7a; }
  .book::before { left: 6px; border-right: 0; transform: skewY(8deg); }
  .book::after { right: 6px; border-left: 0; transform: skewY(-8deg); }
  .mark { margin: 0; color: #113f7a; font-size: 1.03rem; font-weight: 850; letter-spacing: -.025em; }
  .tagline { margin: 3px 0 0; color: #626b78; font-size: .78rem; }
  .content { padding: clamp(24px, 5vw, 40px); }
  h1 { margin: 0; max-width: 19ch; font-size: clamp(1.65rem, 5vw, 2.25rem); line-height: 1.12; letter-spacing: -.035em; text-wrap: balance; }
  .intro { max-width: 58ch; margin: 12px 0 24px; color: #596577; font-size: .93rem; line-height: 1.6; }
  .account { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 22px; padding: 12px 14px; border: 1px solid #d9e1ec; border-radius: 10px; background: #f6f8fb; }
  .account p { margin: 0; color: #596577; font-size: .75rem; line-height: 1.45; }
  .account strong { display: block; color: #14181f; font-size: .86rem; }
  a { color: #073896; font-weight: 700; text-underline-offset: 3px; }
  .account a { flex: 0 0 auto; font-size: .75rem; }
  .notice { margin: 0 0 24px; padding: 15px 16px; border: 1px solid #e7c56b; border-radius: 10px; background: #fff9e8; color: #493b16; font-size: .84rem; line-height: 1.55; }
  .notice strong { display: block; margin-bottom: 4px; color: #2f260d; }
  .error { margin: 0 0 20px; padding: 14px 16px; border: 1px solid #e5a69d; border-radius: 10px; background: #fff0ee; color: #84261d; font-size: .86rem; line-height: 1.5; }
  fieldset { margin: 0 0 16px; padding: 18px; border: 1px solid #dde1e7; border-radius: 12px; }
  legend { padding: 0 7px; color: #113f7a; font-size: .78rem; font-weight: 800; }
  label { display: block; color: #303946; font-size: .82rem; font-weight: 750; }
  label + label { margin-top: 15px; }
  .hint { display: block; margin-top: 3px; color: #667387; font-size: .72rem; font-weight: 450; line-height: 1.45; }
  .password-wrap { position: relative; display: block; }
  input { display: block; width: 100%; min-height: 46px; margin-top: 7px; padding: 0 12px; border: 1px solid #b8c4d2; border-radius: 8px; color: #14181f; background: #fff; font: inherit; caret-color: #073896; }
  input[type="password"], input.password-visible { padding-right: 78px; }
  input::placeholder { color: #69778a; opacity: 1; }
  input:hover { border-color: #7f8fa4; }
  input:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid #d64a35; outline-offset: 2px; }
  .reveal { position: absolute; right: 1px; bottom: 1px; min-height: 44px; padding: 0 10px; border: 0; border-radius: 7px; color: #113f7a; background: #eef2f7; font-size: .7rem; font-weight: 800; }
  button { min-height: 46px; border: 0; border-radius: 8px; font: inherit; font-weight: 800; cursor: pointer; }
  button:disabled { cursor: wait; opacity: .65; }
  .primary { width: 100%; color: #fff; background: #073896; }
  .primary:hover { background: #113f7a; }
  .primary:active { background: #0b121c; }
  .secondary { width: 100%; margin-bottom: 16px; color: #113f7a; background: #eaf0f7; }
  .secondary:hover, .reveal:hover { background: #dce6f2; }
  .form-note { margin: 14px 0 0; color: #69778a; font-size: .72rem; line-height: 1.5; text-align: center; }
  footer { padding: 18px clamp(22px, 5vw, 40px) 22px; border-top: 1px solid #d9e1ec; color: #69778a; background: #f6f8fb; font-size: .7rem; line-height: 1.55; }
  ::selection { color: #fff; background: #073896; }
  @media (max-width: 480px) {
    body { padding: 6px 0 0; background: #fff; }
    body::before { height: 5px; }
    main { border-radius: 0; box-shadow: none; }
    .head { padding-top: 23px; }
    .account { align-items: flex-start; flex-direction: column; }
    fieldset { padding: 15px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; }
  }
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

  for (const toggle of document.querySelectorAll("[data-password-toggle]")) {
    toggle.addEventListener("click", () => {
      const input = document.getElementById(toggle.dataset.passwordToggle);
      if (!(input instanceof HTMLInputElement)) return;
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      input.classList.toggle("password-visible", !visible);
      toggle.textContent = visible ? "Mutasd" : "Rejtsd el";
      toggle.setAttribute("aria-pressed", String(!visible));
    });
  }

  document.querySelector("form")?.addEventListener("submit", (event) => {
    const button = event.currentTarget.querySelector("button[type=submit]");
    if (!(button instanceof HTMLButtonElement)) return;
    button.disabled = true;
    button.textContent = "Kapcsolódás…";
  });
`;

function childFieldset(index: number, profiles: ChildProfile[], selectedName?: string): string {
  const optional = index > 0;
  const visible = !optional || Boolean(selectedName);
  const value = selectedName ?? (index === 0 && profiles.length === 1 ? profiles[0]?.childName : "") ?? "";
  const suffix = index + 1;
  const legend = index === 0 ? "Gyerek" : `${suffix}. gyerek`;
  return `
<fieldset${optional ? ' class="extra"' : ""}${visible ? "" : " hidden disabled"}>
  <legend>${escapeHtml(legend)}</legend>
  <label for="child-${suffix}">A gyerek rendes neve
    <span class="hint">Ezen a néven mentetted a kapcsolati pulton.</span>
    <input id="child-${suffix}" name="childName" type="text" list="child-profiles" autocomplete="section-child-${suffix} username" ${visible ? "required" : ""} value="${escapeHtml(value)}" placeholder="Válassz a mentett nevek közül"></label>
  <label for="password-${suffix}">KRÉTA-jelszó
    <span class="hint">Ezt nem mentjük el; csak a KRÉTA-belépéshez használjuk.</span>
  </label>
  <span class="password-wrap">
    <input id="password-${suffix}" name="password" type="password" autocomplete="section-child-${suffix} current-password" ${visible ? "required" : ""}>
    <button class="reveal" type="button" data-password-toggle="password-${suffix}" aria-pressed="false">Mutasd</button>
  </span>
</fieldset>`;
}

export interface LoginPageParams {
  /** Opaque, sealed continuation of the in-flight authorization request. */
  request: string;
  clientName: string | undefined;
  accountName?: string | undefined;
  manageProfilesUrl?: string | undefined;
  profiles: ChildProfile[];
  selectedNames?: string[] | undefined;
  error?: string | undefined;
}

export function renderLoginPage(params: LoginPageParams): string {
  const client = params.clientName?.trim() || "egy MCP-kliens";
  const account = params.accountName?.replace(/\s+/gu, " ").trim() || "Google-fiókkal belépve";
  const error = params.error
    ? `<p class="error" role="alert">${escapeHtml(params.error)}</p>`
    : "";
  const count = Math.min(params.profiles.length, 3);
  const fieldsets = Array.from({ length: count }, (_, index) =>
    childFieldset(index, params.profiles, params.selectedNames?.[index]),
  ).join("");
  const options = params.profiles
    .map((profile) => `<option value="${escapeHtml(profile.childName)}"></option>`)
    .join("");

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
  <header class="head">
    <span class="book" aria-hidden="true"></span>
    <div><p class="mark">${escapeHtml(BRAND.name)}</p><p class="tagline">${escapeHtml(BRAND.tagline)}</p></div>
  </header>
  <div class="content">
    <h1>${escapeHtml(client)} csatlakoztatása</h1>
    <p class="intro">Válaszd ki, melyik gyerek KRÉTA-adatait olvashatja Claude, majd add meg a hozzá tartozó jelszót.</p>
    <div class="account">
      <p><strong>${escapeHtml(account)}</strong>Ez a Google-fiók adja a mentett gyerekprofilokat.</p>
      <a href="${escapeHtml(params.manageProfilesUrl ?? "/dashboard#gyerekek")}">Profilok kezelése</a>
    </div>
    ${error}
    <p class="notice">
      <strong>A jelszó átmegy az Üzenőfüzet szerverén.</strong>
      A KRÉTA nem ad más belépési lehetőséget külső alkalmazásoknak. A jelszót nem tároljuk és nem naplózzuk; a belépés után eldobjuk.
    </p>
    <form method="post" action="/authorize/login" autocomplete="on">
      <input type="hidden" name="request" value="${escapeHtml(params.request)}">
      <datalist id="child-profiles">${options}</datalist>
      ${fieldsets}
      ${count > 1 ? '<button type="button" class="secondary" id="add">+ Még egy gyerek</button>' : ""}
      <button type="submit" class="primary">Kapcsolódás Claude-hoz</button>
      <p class="form-note">A KRÉTA-felhasználónevet és az intézményt a mentett profilból vesszük elő.</p>
    </form>
  </div>
  <footer>${escapeHtml(BRAND.disclaimer)} Csak olvasás: a kapcsolat semmit nem módosít és nem töröl a KRÉTA-ban.</footer>
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
  <header class="head"><span class="book" aria-hidden="true"></span><div><p class="mark">${escapeHtml(BRAND.name)}</p></div></header>
  <div class="content"><h1>${escapeHtml(title)}</h1><p class="intro">${escapeHtml(detail)}</p><a href="/dashboard">Vissza a kapcsolati pulthoz</a></div>
  <footer>${escapeHtml(BRAND.disclaimer)}</footer>
</main>
</body>
</html>`;
}

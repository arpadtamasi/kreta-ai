/** Intézménykereső a profilszerkesztő űrlapján. */
import type { User } from "firebase/auth";
import { searchInstitutes } from "./api";
import type { InstituteSuggestion } from "./profiles";

export interface InstituteSearch {
  reset(message?: string): void;
}

export function createInstituteSearch(getUser: () => User | null): InstituteSearch {
  const input = document.querySelector<HTMLInputElement>("#institute-code")!;
  const options = document.querySelector<HTMLDataListElement>("#institute-options")!;
  const status = document.querySelector<HTMLElement>("#institute-search-status")!;
  const choices = new Map<string, InstituteSuggestion>();
  let timer: number | undefined;
  let request: AbortController | null = null;
  let requestNumber = 0;

  function reset(message = "") {
    window.clearTimeout(timer);
    request?.abort();
    request = null;
    requestNumber += 1;
    choices.clear();
    options.replaceChildren();
    input.setAttribute("aria-busy", "false");
    status.textContent = message;
    status.dataset.kind = "";
  }

  function label(suggestion: InstituteSuggestion): string {
    return `${suggestion.name} — ${suggestion.code}`;
  }

  function normalize(value: string): string {
    return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  }

  async function run(query: string) {
    const user = getUser();
    if (!user) return;
    const current = ++requestNumber;
    request?.abort();
    request = new AbortController();
    input.setAttribute("aria-busy", "true");
    status.textContent = "Intézmények keresése…";
    status.dataset.kind = "";

    try {
      const suggestions = await searchInstitutes(user, query, request.signal);
      if (current !== requestNumber || normalize(input.value) !== query) return;
      choices.clear();
      options.replaceChildren();
      for (const suggestion of suggestions) {
        const text = label(suggestion);
        choices.set(text, suggestion);
        const option = document.createElement("option");
        option.value = text;
        options.append(option);
      }
      status.textContent = suggestions.length > 0
        ? `${suggestions.length} találat. Válassz egy intézményt a mező javaslatai közül.`
        : "Nincs találat. Az intézménykódot kézzel is beírhatod.";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (current !== requestNumber) return;
      choices.clear();
      options.replaceChildren();
      status.textContent = error instanceof Error
        ? error.message
        : "Az intézménykereső most nem elérhető. A kódot kézzel is beírhatod.";
      status.dataset.kind = "error";
    } finally {
      if (current === requestNumber) {
        input.setAttribute("aria-busy", "false");
        request = null;
      }
    }
  }

  input.addEventListener("input", () => {
    const chosen = choices.get(input.value);
    if (chosen) {
      reset(`Kiválasztva: ${chosen.name} (${chosen.code}).`);
      input.value = chosen.code;
      return;
    }

    window.clearTimeout(timer);
    request?.abort();
    choices.clear();
    options.replaceChildren();
    const query = normalize(input.value);
    if (query.length < 3 || query.includes("://") || query.toLocaleLowerCase("hu-HU").endsWith(".e-kreta.hu")) {
      reset();
      return;
    }
    timer = window.setTimeout(() => void run(query), 280);
  });

  return { reset };
}

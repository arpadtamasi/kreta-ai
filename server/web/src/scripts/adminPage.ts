/** Az iskolai rendszergazdáknak szóló oldal másolási műveletei. */
export function startAdminPage(): void {
  const page = document.querySelector<HTMLElement>("#admin-page");
  const identity = document.querySelector<HTMLElement>("#admin-identity");
  const scopeList = document.querySelector<HTMLElement>("#admin-scope-list");
  const status = document.querySelector<HTMLElement>("#admin-copy-status");
  if (!page || !identity || !scopeList || !status) return;

  function pageLink(): string {
    return new URL("/iskolai-admin", location.href).href;
  }

  /** Az adminnak elég egy szövegblokk: azonosítók, scope-ok és a részletes oldal címe. */
  function approvalText(): string {
    const rows = Array.from(identity!.querySelectorAll("div")).map((row) => {
      const label = row.querySelector("dt")?.textContent?.trim() ?? "";
      const value = row.querySelector("dd")?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
      return `${label}: ${value}`;
    });
    const scopes = Array.from(scopeList!.querySelectorAll("li")).map((row) => {
      const label = row.querySelector("strong")?.textContent?.trim() ?? "";
      const scope = row.querySelector("code")?.textContent?.trim() ?? "";
      return `- ${label}: ${scope}`;
    });
    return [
      "Üzenőfüzet – Google Classroom-hozzáférés engedélyezése",
      "",
      ...rows,
      "",
      "Kért hozzáférések (mind csak olvasás):",
      ...scopes,
      "",
      `Részletes leírás a rendszergazdának: ${pageLink()}`,
    ].join("\n");
  }

  const texts: Record<string, () => string> = { link: pageLink, approval: approvalText };

  page.querySelectorAll<HTMLButtonElement>("button[data-copy]").forEach((button) => {
    const label = button.textContent ?? "";
    button.addEventListener("click", async () => {
      const build = texts[button.dataset.copy ?? ""];
      if (!build) return;
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(build());
        button.textContent = "Kimásolva";
        status.textContent = button.dataset.done ?? "A vágólapra másoltuk.";
        status.dataset.kind = "success";
      } catch {
        status.textContent = "A másolás nem sikerült. Jelöld ki és másold ki kézzel az adatokat.";
        status.dataset.kind = "error";
      } finally {
        button.disabled = false;
        window.setTimeout(() => {
          button.textContent = label;
        }, 4000);
      }
    });
  });
}

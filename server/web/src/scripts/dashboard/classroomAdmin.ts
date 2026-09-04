/** Az iskolai Google-adminnak szóló engedélyezési adatok kimásolása. */
export function startClassroomAdminHelp(): void {
  const clientId = document.querySelector<HTMLElement>("#classroom-client-id");
  const scopeList = document.querySelector<HTMLElement>("#classroom-scope-list");
  const steps = document.querySelector<HTMLOListElement>("#classroom-admin-steps");
  const copyButton = document.querySelector<HTMLButtonElement>("#copy-classroom-admin-data");
  const copyStatus = document.querySelector<HTMLElement>("#classroom-admin-copy-status");
  if (!clientId || !scopeList || !steps || !copyButton || !copyStatus) return;

  function classroomAdminText(): string {
    const scopes = Array.from(scopeList!.querySelectorAll("li")).map((row) => {
      const label = row.querySelector("strong")?.textContent?.trim() ?? "";
      const scope = row.querySelector("code")?.textContent?.trim() ?? "";
      return `- ${label}: ${scope}`;
    });
    const setupSteps = Array.from(steps!.querySelectorAll("li")).map((row, index) =>
      `${index + 1}. ${row.textContent?.replace(/\s+/gu, " ").trim() ?? ""}`
    );
    return [
      "Üzenőfüzet – Google Classroom-hozzáférés",
      "Honlap: https://uzenofuzet.hu",
      "Részletes leírás a rendszergazdának: https://uzenofuzet.hu/iskolai-admin",
      "",
      "OAuth-kliensazonosító:",
      clientId!.textContent?.trim() ?? "",
      "",
      "Kért hozzáférések (csak olvasás):",
      ...scopes,
      "",
      "Beállítás a Google Admin konzolban:",
      ...setupSteps,
    ].join("\n");
  }

  copyButton.addEventListener("click", async () => {
    copyButton.disabled = true;
    copyStatus.textContent = "Másolás…";
    try {
      await navigator.clipboard.writeText(classroomAdminText());
      copyButton.textContent = "Kimásolva";
      copyStatus.textContent = "Az adminnak szükséges adatokat a vágólapra másoltuk.";
    } catch {
      copyStatus.textContent =
        "A másolás nem sikerült. Jelöld ki és másold ki a fenti kliensazonosítót és hozzáféréseket.";
    } finally {
      copyButton.disabled = false;
    }
  });
}

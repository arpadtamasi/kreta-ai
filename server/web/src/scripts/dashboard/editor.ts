/** A gyerekprofil szerkesztője: hozzáadás, adatok módosítása, online kapcsolás. */
import type { User } from "firebase/auth";
import { saveProfile } from "./api";
import { createInstituteSearch } from "./institutes";
import type { Profile } from "./profiles";

export type EditorMode = "new" | "edit" | "connect";

export interface EditorDeps {
  getUser(): User | null;
  setStatus(message: string, kind?: string): void;
  onSaved(): Promise<void>;
}

export interface ProfileEditor {
  open(profile?: Profile, mode?: EditorMode): void;
  close(): void;
}

export function createProfileEditor(deps: EditorDeps): ProfileEditor {
  const dialog = document.querySelector<HTMLDialogElement>("#profile-editor")!;
  const form = document.querySelector<HTMLFormElement>("#profile-form")!;
  const title = document.querySelector<HTMLElement>("#profile-form-title")!;
  const intro = document.querySelector<HTMLElement>("#profile-form-intro")!;
  const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-profile")!;
  const submitButton = form.querySelector<HTMLButtonElement>(".save-profile")!;
  const idInput = document.querySelector<HTMLInputElement>("#profile-id")!;
  const nameInput = document.querySelector<HTMLInputElement>("#child-name")!;
  const usernameInput = document.querySelector<HTMLInputElement>("#kreta-username")!;
  const instituteInput = document.querySelector<HTMLInputElement>("#institute-code")!;
  const passwordInput = document.querySelector<HTMLInputElement>("#kreta-password")!;
  const keepAliveInput = document.querySelector<HTMLInputElement>("#keep-alive")!;
  const keepAliveDeadline = document.querySelector<HTMLElement>("#keep-alive-deadline")!;
  const keepAliveUntilInput = document.querySelector<HTMLInputElement>("#keep-alive-until")!;
  const instituteSearch = createInstituteSearch(deps.getUser);

  function close() {
    if (dialog.open) dialog.close();
  }

  function open(profile?: Profile, mode: EditorMode = profile ? "edit" : "new") {
    instituteSearch.reset();
    idInput.value = profile?.id ?? "";
    nameInput.value = profile?.childName ?? "";
    usernameInput.value = profile?.kretaUsername ?? "";
    instituteInput.value = profile?.instituteCode ?? "";
    passwordInput.value = "";
    keepAliveInput.checked = profile?.connection.keepAlive || false;
    keepAliveUntilInput.value = profile?.connection.keepAliveUntil?.slice(0, 10) ?? "";
    keepAliveDeadline.hidden = !keepAliveInput.checked;
    form.dataset.mode = mode;
    title.textContent = mode === "connect"
      ? `${profile?.childName ?? "A gyerek"} online kapcsolása`
      : mode === "edit"
        ? `${profile?.childName ?? "A gyerek"} profiljának szerkesztése`
        : "Gyerek hozzáadása";
    intro.textContent = mode === "connect"
      ? "A KRÉTA-jelszó csak a kapcsolat létrehozásához kell; nem mentjük el."
      : "A KRÉTA-jelszó csak a kapcsolat létrehozásához kell; nem mentjük el. A profil a te Google-fiókodhoz tartozik.";
    submitButton.textContent = mode === "connect" ? "Online kapcsolás" : "Mentés és kapcsolás";
    if (!dialog.open) dialog.showModal();
    (mode === "connect" ? passwordInput : nameInput).focus();
  }

  dialog.addEventListener("close", () => {
    instituteSearch.reset();
    form.reset();
    idInput.value = "";
    delete form.dataset.mode;
  });

  cancelButton.addEventListener("click", () => close());

  keepAliveInput.addEventListener("change", () => {
    keepAliveDeadline.hidden = !keepAliveInput.checked;
    if (!keepAliveInput.checked) keepAliveUntilInput.value = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submitButton.disabled = true;
    deps.setStatus("Profil mentése…");
    try {
      const user = deps.getUser();
      if (!user) throw new Error("A mentéshez jelentkezz be Google-fiókkal.");
      await saveProfile(user, {
        ...(idInput.value ? { id: idInput.value } : {}),
        childName: nameInput.value,
        kretaUsername: usernameInput.value,
        instituteCode: instituteInput.value,
        password: passwordInput.value,
        keepAlive: keepAliveInput.checked,
        keepAliveUntil: keepAliveInput.checked && keepAliveUntilInput.value
          ? new Date(`${keepAliveUntilInput.value}T23:59:59`).toISOString()
          : null,
      });
      close();
      await deps.onSaved();
    } catch (error) {
      deps.setStatus(error instanceof Error ? error.message : "A profilt nem sikerült elmenteni.", "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  return { open, close };
}

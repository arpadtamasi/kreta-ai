/** A műhely összekötése: belépés, gyereklista, Kezelés panel, szerkesztő. */
import {
  browserLocalPersistence,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { clearSession, establishSession, fetchProfiles } from "./api";
import { renderChildList } from "./childList";
import { auth, provider } from "./firebase";
import { claudeSummary, hasClaudeSource, type Profile } from "./profiles";

export function startDashboard(): void {
  const loading = document.querySelector<HTMLElement>("#profiles-loading")!;
  const signedOut = document.querySelector<HTMLElement>("#profiles-signed-out")!;
  const signedIn = document.querySelector<HTMLElement>("#profiles-signed-in")!;
  const signInButton = document.querySelector<HTMLButtonElement>("#profiles-google-signin")!;
  const signOutButton = document.querySelector<HTMLButtonElement>("#profiles-signout")!;
  const reauthButton = document.querySelector<HTMLButtonElement>("#profiles-reauth")!;
  const signinNote = document.querySelector<HTMLElement>("#step-signin-note")!;
  const accountName = document.querySelector<HTMLElement>("#profiles-account-name")!;
  const steps = document.querySelectorAll<HTMLElement>("#workspace-steps li");
  const status = document.querySelector<HTMLElement>("#profiles-status")!;
  const summary = document.querySelector<HTMLElement>("#claude-summary")!;
  const addButton = document.querySelector<HTMLAnchorElement>("#add-child")!;
  const emptyLink = document.querySelector<HTMLAnchorElement>("#child-empty-link")!;
  const returnPanel = document.querySelector<HTMLElement>("#profiles-return-panel")!;
  const returnTitle = document.querySelector<HTMLElement>("#profiles-return-title")!;
  const returnNote = document.querySelector<HTMLElement>("#profiles-return-note")!;
  const adminHelp = document.querySelector<HTMLDetailsElement>("#classroom-admin-help")!;

  let profiles: Profile[] = [];
  let authResolved = false;

  const candidateReturn = new URLSearchParams(location.search).get("return_to") ?? "";
  const returnTo = candidateReturn.startsWith("/authorize?") && candidateReturn.length <= 12_000
    ? candidateReturn
    : "";
  const classroomResult = new URLSearchParams(location.search).get("classroom") ?? "";
  returnPanel.hidden = !returnTo;

  function setStatus(message: string, kind = "") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  /** A gyerek oldaláról visszahozott eredmény (mentés, törlés) itt jelenik meg. */
  function handedOverStatus(): string {
    const message = sessionStorage.getItem("uzenofuzet-status") ?? "";
    if (message) sessionStorage.removeItem("uzenofuzet-status");
    return message;
  }

  function getUser(): User | null {
    return auth.currentUser;
  }

  /** Amíg a Firebase nem mondta meg, be van-e lépve, egyik állapotot sem mutatjuk. */
  function showAuthState(user: User | null) {
    authResolved = true;
    loading.hidden = true;
    signedOut.hidden = Boolean(user);
    signedIn.hidden = !user;
  }

  // Ha a Firebase nem válaszol, a belépés akkor is elérhető marad.
  window.setTimeout(() => {
    if (authResolved) return;
    loading.hidden = true;
    signedOut.hidden = false;
  }, 3000);

  /** A fejléc lépései mondják meg, hol tart a szülő és mi a következő teendő. */
  function updateSteps(signedIn: boolean) {
    const connected = profiles.some(hasClaudeSource);
    const states = signedIn
      ? ["done", profiles.length === 0 || !connected ? "current" : "done", connected ? "current" : "todo"]
      : ["current", "todo", "todo"];
    steps.forEach((step, index) => {
      const state = states[index]!;
      step.dataset.state = state;
      const marker = step.querySelector<HTMLElement>(".marker")!;
      marker.textContent = state === "done" ? "\u2713" : String(index + 1);
    });
  }

  /** A gyerek kezelése és hozzáadása külön oldalon történik. */
  function childHref(id?: string): string {
    const query = new URLSearchParams();
    if (id) query.set("id", id);
    if (returnTo) query.set("return_to", returnTo);
    const search = query.toString();
    return search ? `/gyerek?${search}` : "/gyerek";
  }

  addButton.href = childHref();
  emptyLink.href = childHref();

  function showReturnAction() {
    if (!returnTo) return;
    returnPanel.hidden = false;
    returnTitle.textContent = "Még egy lépés";
    returnNote.textContent =
      "A gyerekprofiljaid készen vannak. Erősítsd meg a Google-fiókodat; utána automatikusan visszaviszünk a Claude-hoz.";
    reauthButton.textContent = "Kapcsolódás folytatása";
    reauthButton.hidden = false;
  }

  function hideReturnAction() {
    reauthButton.hidden = true;
    if (!returnTo) returnPanel.hidden = true;
  }

  function showProfileRequired() {
    if (!returnTo) return;
    returnPanel.hidden = false;
    returnTitle.textContent = "Előbb adj hozzá egy gyereket";
    returnNote.textContent = "A profil mentése után automatikusan folytatjuk a Claude csatlakoztatását.";
    hideReturnAction();
  }

  function showConnectionRequired() {
    if (!returnTo) return;
    returnPanel.hidden = false;
    returnTitle.textContent = "Előbb kapcsolj adatforrást a gyerekhez";
    returnNote.textContent =
      "Kapcsold Online a KRÉTA-t vagy kösd össze a gyerek iskolai Google-fiókját a Classroommal; utána automatikusan folytatjuk a Claude csatlakoztatását.";
    hideReturnAction();
  }

  /** Az adminsegítség csak akkor foglal helyet, ha az iskola tiltása miatt tényleg kell. */
  function revealAdminHelp() {
    adminHelp.hidden = false;
    adminHelp.open = true;
    adminHelp.dataset.emphasis = "true";
  }

  function showClassroomResult(): boolean {
    if (!classroomResult) return false;
    const outcomes: Record<string, { message: string; kind: string }> = {
      connected: { message: "A gyerek Google Classroom-fiókját összekapcsoltuk.", kind: "success" },
      cancelled: { message: "A Classroom engedélyezését megszakítottad; nem változtattunk semmin.", kind: "" },
      blocked: {
        message:
          "Az iskola még nem engedélyezte az Üzenőfüzetet. Nyisd meg az alábbi adminadatokat, és küldd el az iskolai Google-rendszergazdának.",
        kind: "error",
      },
      profile_missing: { message: "A gyerekprofil közben megszűnt. Indítsd újra az összekapcsolást.", kind: "error" },
      invalid_state: { message: "A Classroom engedélyezési kérés lejárt vagy már felhasználták. Indítsd újra.", kind: "error" },
      failed: {
        message: "A Classroom összekapcsolása nem sikerült. Ellenőrizd, hogy a gyerek iskolai Google-fiókját választottad-e.",
        kind: "error",
      },
    };
    const outcome = outcomes[classroomResult] ?? outcomes.failed!;
    setStatus(outcome.message, outcome.kind);
    if (classroomResult === "blocked") revealAdminHelp();
    const clean = new URL(location.href);
    clean.searchParams.delete("classroom");
    history.replaceState(null, "", `${clean.pathname}${clean.search}${clean.hash}`);
    status.focus();
    return true;
  }

  function renderProfiles() {
    summary.textContent = claudeSummary(profiles);
    updateSteps(true);
    renderChildList(profiles, (profile) => childHref(profile.id));
    addButton.hidden = profiles.length >= 3;

    if (profiles.length === 0) {
      showProfileRequired();
      return;
    }
    if (returnTo && !profiles.some(hasClaudeSource)) showConnectionRequired();
  }

  async function loadProfiles(user: User, continueOAuth = true) {
    profiles = await fetchProfiles(user);
    renderProfiles();
    if (returnTo && profiles.some(hasClaudeSource) && continueOAuth) {
      setStatus("Kész. Visszalépünk a Claude csatlakoztatásához…");
      location.assign(returnTo);
    }
  }

  signInButton.addEventListener("click", async () => {
    signInButton.disabled = true;
    setStatus("Google-belépés…");
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, provider);
    } catch {
      setStatus("A Google-belépés nem sikerült vagy megszakadt.", "error");
      signInButton.disabled = false;
    }
  });

  signOutButton.addEventListener("click", async () => {
    await Promise.allSettled([signOut(auth), clearSession()]);
    profiles = [];
    renderChildList([], () => "/gyerek");
    summary.textContent = "Gyerek hozzáadása és kapcsolása";
    signinNote.textContent = "Belépés Google-fiókkal";
    accountName.hidden = true;
    signOutButton.hidden = true;
    updateSteps(false);
    setStatus("Kijelentkeztél.");
  });

  reauthButton.addEventListener("click", async () => {
    const user = getUser();
    if (!user) return;
    reauthButton.disabled = true;
    reauthButton.textContent = "Google-belépés megnyitása…";
    setStatus("A folytatáshoz erősítsd meg a Google-fiókodat…");
    try {
      await reauthenticateWithPopup(user, provider);
      await establishSession(user);
      hideReturnAction();
      await loadProfiles(user);
      if (!returnTo) setStatus("A belépést megerősítettük.", "success");
    } catch {
      showReturnAction();
      setStatus("A Google-belépés megszakadt. A kapcsolódás folytatásához próbáld újra.", "error");
    } finally {
      reauthButton.disabled = false;
    }
  });

  onAuthStateChanged(auth, async (user) => {
    showAuthState(user);
    signInButton.disabled = false;
    signOutButton.hidden = !user;
    accountName.hidden = !user;
    if (!user) {
      signinNote.textContent = "Belépés Google-fiókkal";
      updateSteps(false);
      if (!returnTo) showClassroomResult();
      return;
    }
    signinNote.textContent = "Belépve";
    accountName.textContent = user.displayName || user.email || "Google-fiók";
    updateSteps(true);
    setStatus("Profilok betöltése…");
    try {
      let canContinue = true;
      try {
        await establishSession(user);
        hideReturnAction();
      } catch {
        canContinue = false;
        showReturnAction();
      }
      await loadProfiles(user, canContinue);
      const handedOver = handedOverStatus();
      if (!canContinue && returnTo && profiles.some(hasClaudeSource)) {
        setStatus("");
      } else if (handedOver) {
        setStatus(handedOver, "success");
      } else if (!returnTo && !showClassroomResult()) {
        setStatus("");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "A profilokat nem sikerült betölteni.", "error");
    }
  });
}

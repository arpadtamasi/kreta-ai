/** A gyerek saját oldala: adatok, kapcsolatok, szerkesztés, veszélyzóna. */
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  deleteProfile,
  disconnectClassroom,
  establishSession,
  fetchProfiles,
  saveProfile,
  startClassroomAuthorization,
  stopKretaConnection,
} from "../dashboard/api";
import { auth } from "../dashboard/firebase";
import { createInstituteSearch } from "../dashboard/institutes";
import {
  classroomDetail,
  classroomLabel,
  isClassroomConnected,
  isOnline,
  kretaDetail,
  kretaLabel,
  type Profile,
} from "../dashboard/profiles";
import { choiceFor, describeChoice, isChoice, keepAlivePayload, type KeepAliveChoice } from "./keepAlive";

type EditorMode = "new" | "edit" | "connect";

export function startChildPage(): void {
  const loading = document.querySelector<HTMLElement>("#child-loading")!;
  const body = document.querySelector<HTMLElement>("#child-body")!;
  const title = document.querySelector<HTMLElement>("#child-title")!;
  const back = document.querySelector<HTMLAnchorElement>("#child-back")!;
  const status = document.querySelector<HTMLElement>("#child-status")!;
  const details = document.querySelector<HTMLElement>("#child-details")!;
  const username = document.querySelector<HTMLElement>("#child-username")!;
  const institute = document.querySelector<HTMLElement>("#child-institute")!;
  const kretaState = document.querySelector<HTMLElement>("#child-kreta-state")!;
  const kretaDetailText = document.querySelector<HTMLElement>("#child-kreta-detail")!;
  const classroomState = document.querySelector<HTMLElement>("#child-classroom-state")!;
  const classroomDetailText = document.querySelector<HTMLElement>("#child-classroom-detail")!;
  const kretaConnect = document.querySelector<HTMLButtonElement>("#child-kreta-connect")!;
  const classroomConnect = document.querySelector<HTMLButtonElement>("#child-classroom-connect")!;
  const editButton = document.querySelector<HTMLButtonElement>("#child-edit")!;
  const dangerKreta = document.querySelector<HTMLElement>("#danger-kreta")!;
  const dangerClassroom = document.querySelector<HTMLElement>("#danger-classroom")!;
  const dangerDelete = document.querySelector<HTMLElement>("#danger-delete")!;
  const adminHelp = document.querySelector<HTMLDetailsElement>("#classroom-admin-help")!;

  const editor = document.querySelector<HTMLElement>("#child-editor")!;
  const form = document.querySelector<HTMLFormElement>("#profile-form")!;
  const formTitle = document.querySelector<HTMLElement>("#profile-form-title")!;
  const formIntro = document.querySelector<HTMLElement>("#profile-form-intro")!;
  const idInput = document.querySelector<HTMLInputElement>("#profile-id")!;
  const nameInput = document.querySelector<HTMLInputElement>("#child-name")!;
  const usernameInput = document.querySelector<HTMLInputElement>("#kreta-username")!;
  const instituteInput = document.querySelector<HTMLInputElement>("#institute-code")!;
  const passwordInput = document.querySelector<HTMLInputElement>("#kreta-password")!;
  const keepAliveNote = document.querySelector<HTMLElement>("#keep-alive-note")!;
  const cancelButton = document.querySelector<HTMLButtonElement>("#cancel-profile")!;
  const submitButton = form.querySelector<HTMLButtonElement>(".save-profile")!;

  const params = new URLSearchParams(location.search);
  const profileId = params.get("id") ?? "";
  const candidateReturn = params.get("return_to") ?? "";
  const returnTo = candidateReturn.startsWith("/authorize?") && candidateReturn.length <= 12_000
    ? candidateReturn
    : "";
  const classroomResult = params.get("classroom") ?? "";
  const backHref = returnTo ? `/?${new URLSearchParams({ return_to: returnTo }).toString()}` : "/";
  back.href = backHref;

  const instituteSearch = createInstituteSearch(() => auth.currentUser);
  let profile: Profile | null = null;

  function setStatus(message: string, kind = "") {
    status.textContent = message;
    status.dataset.kind = kind;
  }

  function keepAliveChoice(): KeepAliveChoice {
    const checked = form.querySelector<HTMLInputElement>("input[name=keepAliveWindow]:checked");
    return checked && isChoice(checked.value) ? checked.value : "trial";
  }

  function selectKeepAlive(choice: KeepAliveChoice) {
    for (const input of form.querySelectorAll<HTMLInputElement>("input[name=keepAliveWindow]")) {
      input.checked = input.value === choice;
    }
    keepAliveNote.textContent = describeChoice(choice);
  }

  form.addEventListener("change", (event) => {
    if ((event.target as HTMLInputElement).name === "keepAliveWindow") {
      keepAliveNote.textContent = describeChoice(keepAliveChoice());
    }
  });

  function openEditor(mode: EditorMode) {
    instituteSearch.reset();
    idInput.value = profile?.id ?? "";
    nameInput.value = profile?.childName ?? "";
    usernameInput.value = profile?.kretaUsername ?? "";
    instituteInput.value = profile?.instituteCode ?? "";
    passwordInput.value = "";
    selectKeepAlive(choiceFor(profile ?? undefined));
    form.dataset.mode = mode;
    // Új gyereknél az oldal címe már kimondja, mi történik; ne ismételjük meg.
    formTitle.hidden = mode === "new";
    formTitle.textContent = mode === "connect" ? "Online kapcsolás" : "Profil szerkesztése";
    formIntro.textContent = mode === "connect"
      ? "A KRÉTA-jelszó csak a kapcsolat létrehozásához kell; nem mentjük el."
      : "A KRÉTA-jelszó csak a kapcsolat létrehozásához kell; nem mentjük el. A profil a te Google-fiókodhoz tartozik.";
    submitButton.textContent = mode === "connect" ? "Online kapcsolás" : "Mentés és kapcsolás";
    editor.hidden = false;
    details.hidden = mode !== "new" ? true : details.hidden;
    (mode === "connect" ? passwordInput : nameInput).focus();
  }

  function closeEditor() {
    editor.hidden = true;
    instituteSearch.reset();
    form.reset();
    delete form.dataset.mode;
    if (profile) details.hidden = false;
  }

  function renderProfile() {
    if (!profile) return;
    const online = isOnline(profile);
    const classroomConnected = isClassroomConnected(profile);
    title.textContent = profile.childName;
    document.title = `${profile.childName} – Üzenőfüzet`;
    username.textContent = profile.kretaUsername;
    institute.textContent = profile.instituteCode;
    kretaState.textContent = kretaLabel(profile);
    kretaState.classList.toggle("online", online);
    kretaDetailText.textContent = kretaDetail(profile);
    classroomState.textContent = classroomLabel(profile);
    classroomState.classList.toggle("online", classroomConnected);
    classroomDetailText.textContent = classroomDetail(profile);
    kretaConnect.hidden = online;
    classroomConnect.hidden = classroomConnected;
    classroomConnect.textContent = profile.classroom.status === "expired"
      ? "Classroom újrakapcsolása"
      : "Classroom összekapcsolása";
    dangerKreta.hidden = !online;
    dangerClassroom.hidden = !classroomConnected;
    for (const target of document.querySelectorAll<HTMLElement>("[data-child-name]")) {
      target.textContent = profile.childName;
    }
    details.hidden = false;
  }

  async function load(user: User) {
    const profiles = await fetchProfiles(user);
    profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
    if (!profile) {
      details.hidden = true;
      editor.hidden = true;
      setStatus("Ez a gyerekprofil már nem található. Térj vissza a listához.", "error");
      return;
    }
    renderProfile();
  }

  function collapseConfirms() {
    for (const item of [dangerKreta, dangerClassroom, dangerDelete]) {
      item.querySelector<HTMLElement>("[data-danger-confirm-box]")!.hidden = true;
      item.querySelector<HTMLButtonElement>("[data-danger-open]")!.hidden = false;
    }
  }

  /** A veszélyes műveletek külön, kétlépcsős megerősítéssel futnak. */
  function bindDanger(
    item: HTMLElement,
    run: (current: Profile, user: User) => Promise<string>,
    leaves = false,
  ) {
    const openButton = item.querySelector<HTMLButtonElement>("[data-danger-open]")!;
    const confirmBox = item.querySelector<HTMLElement>("[data-danger-confirm-box]")!;
    const confirmButton = item.querySelector<HTMLButtonElement>("[data-danger-confirm]")!;
    const cancelDanger = item.querySelector<HTMLButtonElement>("[data-danger-cancel]")!;

    openButton.addEventListener("click", () => {
      collapseConfirms();
      openButton.hidden = true;
      confirmBox.hidden = false;
      confirmButton.focus();
    });

    cancelDanger.addEventListener("click", () => {
      confirmBox.hidden = true;
      openButton.hidden = false;
      openButton.focus();
    });

    confirmButton.addEventListener("click", async () => {
      const current = profile;
      const user = auth.currentUser;
      if (!current || !user) return;
      confirmButton.disabled = true;
      setStatus("Művelet folyamatban…");
      try {
        const message = await run(current, user);
        if (leaves) {
          sessionStorage.setItem("uzenofuzet-status", message);
          location.assign(backHref);
          return;
        }
        collapseConfirms();
        await load(user);
        setStatus(message, "success");
        status.focus();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "A művelet nem sikerült.", "error");
      } finally {
        confirmButton.disabled = false;
      }
    });
  }

  bindDanger(dangerKreta, async (current, user) => {
    await stopKretaConnection(user, current.id);
    return `${current.childName} KRÉTA-kapcsolata Offline. A gyerekprofil megmaradt.`;
  });

  bindDanger(dangerClassroom, async (current, user) => {
    await disconnectClassroom(user, current.id);
    return `${current.childName} Classroom-fiókját leválasztottuk. A gyerekprofil megmaradt.`;
  });

  bindDanger(dangerDelete, async (current, user) => {
    await deleteProfile(user, current.id);
    return `${current.childName} profilját a KRÉTA- és Classroom-kapcsolatával együtt töröltük.`;
  }, true);

  editButton.addEventListener("click", () => openEditor("edit"));
  kretaConnect.addEventListener("click", () => openEditor("connect"));

  classroomConnect.addEventListener("click", async () => {
    const current = profile;
    const user = auth.currentUser;
    if (!current || !user) return;
    classroomConnect.disabled = true;
    setStatus("Az iskolai Google-belépés megnyitása…");
    try {
      location.assign(await startClassroomAuthorization(user, current.id, returnTo));
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "A Classroom összekapcsolását nem sikerült elindítani.",
        "error",
      );
      classroomConnect.disabled = false;
    }
  });

  cancelButton.addEventListener("click", () => {
    if (!profileId) {
      location.assign(backHref);
      return;
    }
    closeEditor();
    editButton.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const user = auth.currentUser;
    if (!user) return;
    submitButton.disabled = true;
    setStatus("Profil mentése…");
    try {
      await saveProfile(user, {
        ...(idInput.value ? { id: idInput.value } : {}),
        childName: nameInput.value,
        kretaUsername: usernameInput.value,
        instituteCode: instituteInput.value,
        password: passwordInput.value,
        ...keepAlivePayload(keepAliveChoice()),
      });
      if (!profileId) {
        sessionStorage.setItem("uzenofuzet-status", `${nameInput.value} profilját elmentettük.`);
        location.assign(backHref);
        return;
      }
      closeEditor();
      await load(user);
      setStatus("A gyerekprofilt elmentettük.", "success");
      status.focus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "A profilt nem sikerült elmenteni.", "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  function showClassroomResult() {
    if (!classroomResult) return;
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
    if (classroomResult === "blocked") {
      adminHelp.hidden = false;
      adminHelp.open = true;
      adminHelp.dataset.emphasis = "true";
    }
    const clean = new URL(location.href);
    clean.searchParams.delete("classroom");
    history.replaceState(null, "", `${clean.pathname}${clean.search}`);
    status.focus();
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.replace(backHref);
      return;
    }
    loading.hidden = true;
    body.hidden = false;
    try {
      await establishSession(user);
    } catch {
      setStatus("A Google-munkamenetet nem sikerült megújítani. A Classroom összekapcsolásához lépj be újra.", "error");
    }
    try {
      if (profileId) await load(user);
      else openEditor("new");
      showClassroomResult();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "A gyerek adatait nem sikerült betölteni.", "error");
    }
  });
}

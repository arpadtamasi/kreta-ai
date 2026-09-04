/** A „Kezelés” panel: egy gyerek részletei, kapcsolatai és veszélyzónája. */
import type { User } from "firebase/auth";
import { deleteProfile, disconnectClassroom, startClassroomAuthorization, stopKretaConnection } from "./api";
import {
  classroomDetail,
  classroomLabel,
  isClassroomConnected,
  isOnline,
  kretaDetail,
  kretaLabel,
  type Profile,
} from "./profiles";

export interface ManagePanelDeps {
  getUser(): User | null;
  setStatus(message: string, kind?: string): void;
  reload(): Promise<void>;
  focusStatus(): void;
  editProfile(profile: Profile, mode: "edit" | "connect"): void;
  getReturnTo(): string;
}

export interface ManagePanel {
  open(profile: Profile): void;
}

export function createManagePanel(deps: ManagePanelDeps): ManagePanel {
  const dialog = document.querySelector<HTMLDialogElement>("#manage-panel")!;
  const title = document.querySelector<HTMLElement>("#manage-title")!;
  const username = document.querySelector<HTMLElement>("#manage-username")!;
  const institute = document.querySelector<HTMLElement>("#manage-institute")!;
  const kretaState = document.querySelector<HTMLElement>("#manage-kreta-state")!;
  const kretaDetailText = document.querySelector<HTMLElement>("#manage-kreta-detail")!;
  const classroomState = document.querySelector<HTMLElement>("#manage-classroom-state")!;
  const classroomDetailText = document.querySelector<HTMLElement>("#manage-classroom-detail")!;
  const editButton = document.querySelector<HTMLButtonElement>("#manage-edit")!;
  const kretaConnectButton = document.querySelector<HTMLButtonElement>("#manage-kreta-connect")!;
  const classroomConnectButton = document.querySelector<HTMLButtonElement>("#manage-classroom-connect")!;
  const closeButton = document.querySelector<HTMLButtonElement>("#manage-close")!;
  const panelStatus = document.querySelector<HTMLElement>("#manage-status")!;
  const dangerKreta = document.querySelector<HTMLElement>("#danger-kreta")!;
  const dangerClassroom = document.querySelector<HTMLElement>("#danger-classroom")!;
  const dangerDelete = document.querySelector<HTMLElement>("#danger-delete")!;
  let current: Profile | null = null;

  function setPanelStatus(message: string, kind = "") {
    panelStatus.textContent = message;
    panelStatus.dataset.kind = kind;
  }

  function collapseConfirms() {
    for (const item of [dangerKreta, dangerClassroom, dangerDelete]) {
      item.querySelector<HTMLElement>("[data-danger-confirm-box]")!.hidden = true;
      item.querySelector<HTMLButtonElement>("[data-danger-open]")!.hidden = false;
    }
  }

  /** A veszélyes műveletek külön, kétlépcsős megerősítéssel futnak. */
  function bindDanger(item: HTMLElement, run: (profile: Profile, user: User) => Promise<string>) {
    const openButton = item.querySelector<HTMLButtonElement>("[data-danger-open]")!;
    const confirmBox = item.querySelector<HTMLElement>("[data-danger-confirm-box]")!;
    const confirmButton = item.querySelector<HTMLButtonElement>("[data-danger-confirm]")!;
    const cancelButton = item.querySelector<HTMLButtonElement>("[data-danger-cancel]")!;

    openButton.addEventListener("click", () => {
      collapseConfirms();
      openButton.hidden = true;
      confirmBox.hidden = false;
      confirmButton.focus();
    });

    cancelButton.addEventListener("click", () => {
      confirmBox.hidden = true;
      openButton.hidden = false;
      openButton.focus();
    });

    confirmButton.addEventListener("click", async () => {
      const profile = current;
      const user = deps.getUser();
      if (!profile || !user) return;
      confirmButton.disabled = true;
      setPanelStatus("Művelet folyamatban…");
      try {
        const message = await run(profile, user);
        dialog.close();
        deps.setStatus(message, "success");
        await deps.reload();
        deps.focusStatus();
      } catch (error) {
        setPanelStatus(error instanceof Error ? error.message : "A művelet nem sikerült.", "error");
      } finally {
        confirmButton.disabled = false;
      }
    });
  }

  bindDanger(dangerKreta, async (profile, user) => {
    await stopKretaConnection(user, profile.id);
    return `${profile.childName} KRÉTA-kapcsolata Offline. A gyerekprofil megmaradt.`;
  });

  bindDanger(dangerClassroom, async (profile, user) => {
    await disconnectClassroom(user, profile.id);
    return `${profile.childName} Classroom-fiókját leválasztottuk. A gyerekprofil megmaradt.`;
  });

  bindDanger(dangerDelete, async (profile, user) => {
    await deleteProfile(user, profile.id);
    return `${profile.childName} profilját a KRÉTA- és Classroom-kapcsolatával együtt töröltük.`;
  });

  editButton.addEventListener("click", () => {
    const profile = current;
    if (!profile) return;
    dialog.close();
    deps.editProfile(profile, "edit");
  });

  kretaConnectButton.addEventListener("click", () => {
    const profile = current;
    if (!profile) return;
    dialog.close();
    deps.editProfile(profile, "connect");
  });

  classroomConnectButton.addEventListener("click", async () => {
    const profile = current;
    const user = deps.getUser();
    if (!profile || !user) return;
    classroomConnectButton.disabled = true;
    setPanelStatus("Az iskolai Google-belépés megnyitása…");
    try {
      location.assign(await startClassroomAuthorization(user, profile.id, deps.getReturnTo()));
    } catch (error) {
      setPanelStatus(
        error instanceof Error ? error.message : "A Classroom összekapcsolását nem sikerült elindítani.",
        "error",
      );
      classroomConnectButton.disabled = false;
    }
  });

  closeButton.addEventListener("click", () => dialog.close());

  function open(profile: Profile) {
    current = profile;
    collapseConfirms();
    setPanelStatus("");
    classroomConnectButton.disabled = false;

    const online = isOnline(profile);
    const classroomConnected = isClassroomConnected(profile);
    title.textContent = profile.childName;
    username.textContent = profile.kretaUsername;
    institute.textContent = profile.instituteCode;
    kretaState.textContent = kretaLabel(profile);
    kretaState.classList.toggle("online", online);
    kretaDetailText.textContent = kretaDetail(profile);
    classroomState.textContent = classroomLabel(profile);
    classroomState.classList.toggle("online", classroomConnected);
    classroomDetailText.textContent = classroomDetail(profile);

    kretaConnectButton.hidden = online;
    classroomConnectButton.hidden = classroomConnected;
    classroomConnectButton.textContent = profile.classroom.status === "expired"
      ? "Classroom újrakapcsolása"
      : "Classroom összekapcsolása";
    dangerKreta.hidden = !online;
    dangerClassroom.hidden = !classroomConnected;
    for (const target of dialog.querySelectorAll<HTMLElement>("[data-child-name]")) {
      target.textContent = profile.childName;
    }

    if (!dialog.open) dialog.showModal();
    title.focus();
  }

  return { open };
}

/** A napi gyereklista: név, két állapot, Kezelés. Semmi más. */
import {
  classroomLabel,
  isClassroomConnected,
  isOnline,
  kretaLabel,
  type Profile,
} from "./profiles";

export function renderChildList(profiles: Profile[], onManage: (profile: Profile) => void): void {
  const list = document.querySelector<HTMLOListElement>("#child-list")!;
  const empty = document.querySelector<HTMLElement>("#child-empty")!;
  const template = document.querySelector<HTMLTemplateElement>("#child-row")!;

  list.replaceChildren();
  empty.hidden = profiles.length > 0;

  for (const profile of profiles) {
    const row = template.content.cloneNode(true) as DocumentFragment;
    row.querySelector<HTMLElement>(".child-name")!.textContent = profile.childName;

    const kreta = row.querySelector<HTMLElement>(".kreta-state")!;
    kreta.querySelector<HTMLElement>(".state-label")!.textContent = kretaLabel(profile);
    kreta.classList.toggle("online", isOnline(profile));

    const classroom = row.querySelector<HTMLElement>(".classroom-state")!;
    classroom.querySelector<HTMLElement>(".state-label")!.textContent = classroomLabel(profile);
    classroom.classList.toggle("online", isClassroomConnected(profile));

    const manage = row.querySelector<HTMLButtonElement>(".child-manage")!;
    manage.setAttribute("aria-label", `${profile.childName} kezelése`);
    manage.addEventListener("click", () => onManage(profile));

    list.append(row);
  }
}

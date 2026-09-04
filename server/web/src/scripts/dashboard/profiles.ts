/** Gyerekprofil-modell és a belőle levezetett napi állapotok. */

export interface Profile {
  id: string;
  childName: string;
  kretaUsername: string;
  instituteCode: string;
  connection: {
    status: "active" | "attention" | "expired" | "disconnected";
    keepAlive: boolean;
    connectedAt: string | null;
    refreshedAt: string | null;
    expiresAt: string | null;
    keepAliveUntil: string | null;
  };
  classroom: {
    status: "connected" | "expired" | "disconnected";
    email: string | null;
    connectedAt: string | null;
    expiresAt: string | null;
  };
}

export interface InstituteSuggestion {
  code: string;
  name: string;
}

export function isOnline(profile: Profile): boolean {
  return (profile.connection.status === "active" || profile.connection.status === "attention") &&
    Boolean(profile.connection.expiresAt) &&
    Date.now() < Date.parse(profile.connection.expiresAt!) &&
    (!profile.connection.keepAliveUntil || Date.now() < Date.parse(profile.connection.keepAliveUntil));
}

export function isClassroomConnected(profile: Profile): boolean {
  return profile.classroom.status === "connected" &&
    Boolean(profile.classroom.expiresAt) &&
    Date.now() < Date.parse(profile.classroom.expiresAt!);
}

export function hasClaudeSource(profile: Profile): boolean {
  return isOnline(profile) || isClassroomConnected(profile);
}

/** A workspace fejlécének összegzése: hány gyerek adatait éri el Claude. */
export function claudeSummary(profiles: Profile[]): string {
  if (profiles.length === 0) return "Még nincs gyerek a listában.";
  const ready = profiles.filter(hasClaudeSource).length;
  return `${profiles.length} gyerekből ${ready} elérhető Claude-nak`;
}

export function kretaLabel(profile: Profile): string {
  return isOnline(profile) ? "KRÉTA · Online" : "KRÉTA · Offline";
}

export function classroomLabel(profile: Profile): string {
  return isClassroomConnected(profile) ? "Classroom · kapcsolva" : "Classroom · nincs";
}

function day(value: string): string {
  return new Date(value).toLocaleDateString("hu-HU");
}

function moment(value: string): string {
  return new Date(value).toLocaleString("hu-HU", { dateStyle: "short", timeStyle: "short" });
}

/** A ritkán kellő KRÉTA-részletek: csak a Kezelés panelen jelennek meg. */
export function kretaDetail(profile: Profile): string {
  if (!isOnline(profile)) {
    return profile.connection.status === "expired"
      ? "A kapcsolat lejárt. Add meg újra a KRÉTA-jelszót az online kapcsoláshoz."
      : "Nincs élő kapcsolat. Add meg a KRÉTA-jelszót az online kapcsoláshoz.";
  }
  const parts = [profile.connection.keepAlive ? "25 percenként frissül" : "30 perces próba"];
  if (profile.connection.keepAlive && profile.connection.keepAliveUntil) {
    parts.push(`${day(profile.connection.keepAliveUntil)}-ig tartjuk online`);
  }
  if (profile.connection.expiresAt) parts.push(`a mostani token ${moment(profile.connection.expiresAt)}-kor jár le`);
  return `${parts.join(" · ")}.`;
}

export function classroomDetail(profile: Profile): string {
  if (isClassroomConnected(profile)) {
    return `${profile.classroom.email ?? "Iskolai Google-fiók"} · kapcsolva${
      profile.classroom.connectedAt ? ` ${moment(profile.classroom.connectedAt)}-kor` : ""
    }.`;
  }
  return profile.classroom.status === "expired"
    ? "A Classroom-engedély lejárt. Kapcsold össze újra a gyerek iskolai Google-fiókját."
    : "Nincs összekapcsolva. A gyerek iskolai Google-fiókja kell hozzá.";
}

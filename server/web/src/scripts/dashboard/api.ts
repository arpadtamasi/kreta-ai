/** Az Üzenőfüzet saját API-hívásai; mindegyik a belépett szülő nevében megy. */
import type { User } from "firebase/auth";
import type { InstituteSuggestion, Profile } from "./profiles";

async function authHeaders(user: User): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

async function jsonOrThrow<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? fallback);
  return data;
}

export async function establishSession(user: User): Promise<void> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: await user.getIdToken(true) }),
  });
  await jsonOrThrow(response, "A Google-munkamenetet nem sikerült létrehozni.");
}

export async function clearSession(): Promise<void> {
  await fetch("/api/session", { method: "DELETE" });
}

export async function fetchProfiles(user: User): Promise<Profile[]> {
  const response = await fetch("/api/profiles", { headers: await authHeaders(user), cache: "no-store" });
  const data = await jsonOrThrow<{ profiles?: Profile[] }>(response, "A gyerekprofilokat nem sikerült betölteni.");
  if (!data.profiles) throw new Error("A gyerekprofilokat nem sikerült betölteni.");
  return data.profiles;
}

export interface ProfileInput {
  id?: string;
  childName: string;
  kretaUsername: string;
  instituteCode: string;
  password: string;
  keepAlive: boolean;
  keepAliveUntil: string | null;
}

export async function saveProfile(user: User, input: ProfileInput): Promise<void> {
  const response = await fetch("/api/profiles", {
    method: "PUT",
    headers: { "content-type": "application/json", ...await authHeaders(user) },
    body: JSON.stringify(input),
  });
  await jsonOrThrow(response, "A profilt nem sikerült elmenteni.");
}

export async function deleteProfile(user: User, id: string): Promise<void> {
  const response = await fetch(`/api/profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(user),
  });
  if (!response.ok) throw new Error("A profilt nem sikerült törölni. Próbáld újra.");
}

export async function stopKretaConnection(user: User, id: string): Promise<void> {
  const response = await fetch(`/api/profiles/${encodeURIComponent(id)}/connection`, {
    method: "DELETE",
    headers: await authHeaders(user),
  });
  if (!response.ok) throw new Error("A kapcsolatot nem sikerült leállítani. Próbáld újra.");
}

export async function disconnectClassroom(user: User, id: string): Promise<void> {
  const response = await fetch(`/api/classroom/${encodeURIComponent(id)}/connection`, {
    method: "DELETE",
    headers: await authHeaders(user),
  });
  if (!response.ok) throw new Error("A Classroom-kapcsolatot nem sikerült törölni. Próbáld újra.");
}

export async function startClassroomAuthorization(
  user: User,
  profileId: string,
  returnTo: string,
): Promise<string> {
  const response = await fetch("/api/classroom/authorize", {
    method: "POST",
    headers: { "content-type": "application/json", ...await authHeaders(user) },
    body: JSON.stringify({ profileId, ...(returnTo ? { returnTo } : {}) }),
  });
  const data = await jsonOrThrow<{ authorizationUrl?: string }>(
    response,
    "A Classroom összekapcsolását nem sikerült elindítani.",
  );
  if (!data.authorizationUrl) throw new Error("A Classroom összekapcsolását nem sikerült elindítani.");
  return data.authorizationUrl;
}

export async function searchInstitutes(
  user: User,
  query: string,
  signal: AbortSignal,
): Promise<InstituteSuggestion[]> {
  const response = await fetch("/api/institutes", {
    method: "POST",
    headers: { "content-type": "application/json", ...await authHeaders(user) },
    body: JSON.stringify({ q: query }),
    cache: "no-store",
    signal,
  });
  const data = await jsonOrThrow<{ suggestions?: InstituteSuggestion[] }>(
    response,
    "Az intézménykereső most nem elérhető.",
  );
  if (!data.suggestions) throw new Error("Az intézménykereső most nem elérhető.");
  return data.suggestions;
}

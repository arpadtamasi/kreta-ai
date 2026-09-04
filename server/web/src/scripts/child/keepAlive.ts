/** „Meddig maradjon online?” — fix időszakok abszolút határidővé fordítva. */
import type { Profile } from "../dashboard/profiles";

export type KeepAliveChoice = "trial" | "7" | "14" | "30" | "none";

const CHOICES: KeepAliveChoice[] = ["trial", "7", "14", "30", "none"];

export function isChoice(value: string): value is KeepAliveChoice {
  return (CHOICES as string[]).includes(value);
}

/** A megadott nap végéig tartjuk online; a szerver egy éven belüli határidőt fogad el. */
export function deadlineFor(choice: KeepAliveChoice, from = new Date()): string | null {
  if (choice === "trial" || choice === "none") return null;
  const end = new Date(from);
  end.setDate(end.getDate() + Number(choice));
  end.setHours(23, 59, 59, 0);
  return end.toISOString();
}

export function keepAlivePayload(choice: KeepAliveChoice): { keepAlive: boolean; keepAliveUntil: string | null } {
  return { keepAlive: choice !== "trial", keepAliveUntil: deadlineFor(choice) };
}

/** Szerkesztéskor a meglévő beállításhoz legközelebbi időszak jelölődik be. */
export function choiceFor(profile?: Profile): KeepAliveChoice {
  if (!profile || !profile.connection.keepAlive) return "trial";
  if (!profile.connection.keepAliveUntil) return "none";
  const days = (Date.parse(profile.connection.keepAliveUntil) - Date.now()) / 86_400_000;
  if (days <= 7) return "7";
  if (days <= 14) return "14";
  if (days <= 30) return "30";
  return "none";
}

export function describeChoice(choice: KeepAliveChoice, from = new Date()): string {
  if (choice === "trial") return "A kapcsolat 30 perc múlva magától Offline lesz.";
  if (choice === "none") return "Amíg le nem állítod, 25 percenként megújítjuk a kapcsolatot.";
  const deadline = deadlineFor(choice, from)!;
  return `${new Date(deadline).toLocaleDateString("hu-HU")}-ig tartjuk online, 25 percenként megújítva.`;
}

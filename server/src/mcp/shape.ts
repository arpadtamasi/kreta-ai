/**
 * Response shaping and argument validation, ported from
 * python/kreta_mcp_server.py so both servers answer with the same envelope.
 *
 * Every list answer is capped and reports whether it was truncated: a school
 * year of evaluations or timetable items would otherwise flood the model's
 * context with personal data nobody asked to see.
 */
import { ToolError } from "./context.js";

export const MAX_ITEMS = 500;
export const MAX_RANGE_DAYS = 120;

export function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ITEMS) {
    throw new ToolError(`A limit 1 és ${MAX_ITEMS} közötti egész szám legyen.`);
  }
  return limit;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolError("A dátum formátuma YYYY-MM-DD legyen.");
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolError("A dátum formátuma YYYY-MM-DD legyen.");
  }
  return parsed;
}

function shiftDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function dateRange(
  startDate: string | undefined,
  endDate: string | undefined,
  options: { defaultStartDays: number; defaultEndDays?: number; today?: Date },
): { start: string; end: string } {
  const today = options.today ?? new Date(`${isoDay(new Date())}T00:00:00Z`);
  const start = startDate ? parseDate(startDate) : shiftDays(today, options.defaultStartDays);
  const end = endDate ? parseDate(endDate) : shiftDays(today, options.defaultEndDays ?? 0);

  if (end < start) {
    throw new ToolError("A záró dátum nem lehet korábbi a kezdő dátumnál.");
  }
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new ToolError(`Legfeljebb ${MAX_RANGE_DAYS} napos időszak kérhető le.`);
  }
  return { start: isoDay(start), end: isoDay(end) };
}

export interface PackedList {
  items: unknown[];
  returned: number;
  total: number;
  truncated: boolean;
}

export function pack(data: unknown, limit?: number): PackedList | { data: unknown } {
  if (Array.isArray(data)) {
    const safeLimit = validateLimit(limit ?? MAX_ITEMS);
    const items = data.slice(0, safeLimit);
    return { items, returned: items.length, total: data.length, truncated: items.length < data.length };
  }
  return { data };
}

export function requireUid(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new ToolError(`Érvénytelen ${label}.`);
  }
  return normalized;
}

/**
 * Pulls the distinct study-task uids out of the class-groups response; the
 * class-average endpoint is per study task, so this drives that fan-out.
 */
export function studyTaskUids(groups: unknown): string[] {
  if (!Array.isArray(groups)) return [];
  const result: string[] = [];
  for (const group of groups) {
    if (typeof group !== "object" || group === null) continue;
    const task = (group as Record<string, unknown>).OktatasNevelesiFeladat;
    if (typeof task !== "object" || task === null) continue;
    const raw = (task as Record<string, unknown>).Uid ?? (task as Record<string, unknown>).uid;
    if (raw === undefined || raw === null) continue;
    const normalized = String(raw).split(",", 1)[0] ?? "";
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

/** Bangkok is UTC+7 all year (no daylight saving), so a fixed offset is exact. */
export const TZ = "Asia/Bangkok";
const OFFSET = "+07:00";

/** "2026-10-20T18:00" from a datetime-local input, read as Bangkok time → ISO. */
export function bangkokLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → "2026-10-20T18:00" in Bangkok time, for datetime-local inputs. */
export function isoToBangkokLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return d.toISOString().slice(0, 16);
}

/** "2026-10-20" (a Bangkok calendar day) → [start, end) as ISO strings. */
export function bangkokDayRange(day: string): [string, string] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(`${day}T00:00:00${OFFSET}`);
  if (Number.isNaN(start.getTime())) return null;
  return [start.toISOString(), new Date(start.getTime() + 86400_000).toISOString()];
}

export function todayInBangkok(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fullFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatDay(iso: string): string {
  return dayFmt.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatFullDate(iso: string): string {
  return fullFmt.format(new Date(iso));
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)}–${formatTime(endIso)}`;
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return formatDay(iso);
}

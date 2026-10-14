/**
 * Sports on Rallyz. Every sport gets its own section of the site:
 * /tennis/events, /tennis/partner, /tennis/instructors, /tennis/levels.
 *
 * To add a sport later: add it here, give it a level scale, and its
 * pages exist at /<slug>/... straight away.
 */
export const SPORTS = [{ slug: "tennis", name: "Tennis" }] as const;

export type Sport = (typeof SPORTS)[number]["slug"];

export const DEFAULT_SPORT: Sport = "tennis";

export function isSport(value: unknown): value is Sport {
  return typeof value === "string" && SPORTS.some((s) => s.slug === value);
}

/** A known sport, or the default one. */
export function toSport(value: unknown): Sport {
  return isSport(value) ? value : DEFAULT_SPORT;
}

export function sportName(sport: string): string {
  return SPORTS.find((s) => s.slug === sport)?.name ?? sport;
}

/** "/events/123" in tennis -> "/tennis/events/123". */
export function sportPath(sport: string, path: string): string {
  return `/${toSport(sport)}${path.startsWith("/") ? path : `/${path}`}`;
}

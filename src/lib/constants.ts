/** Rallyz tennis level scale. Every filter, chip and rule uses these numbers. */
export const LEVELS = [
  { level: 1, name: "New to tennis", ntrp: "1.0–1.5", description: "Just starting out. Learning grips and how to keep the ball in play." },
  { level: 2, name: "Beginner", ntrp: "2.0", description: "Can keep a slow rally going from the baseline. Learning to serve." },
  { level: 3, name: "Improving beginner", ntrp: "2.5", description: "Steady forehand, developing backhand and serve. Enjoys casual doubles." },
  { level: 4, name: "Lower intermediate", ntrp: "3.0", description: "Rallies at moderate pace, gets most first serves in, knows doubles positions." },
  { level: 5, name: "Intermediate", ntrp: "3.5", description: "Directs the ball, uses some spin, comfortable at the net. Plays regular matches." },
  { level: 6, name: "Upper intermediate", ntrp: "4.0", description: "Hits with pace and control, reliable second serve, plays club leagues." },
  { level: 7, name: "Advanced", ntrp: "4.5", description: "Strong all-court game with weapons. Competes in and wins local tournaments." },
  { level: 8, name: "Expert", ntrp: "5.0–5.5", description: "Regional or national competitor; former academy or college player." },
  { level: 9, name: "Pro", ntrp: "6.0+", description: "Plays or played professionally or at national-ranking level." },
] as const;

export function levelName(level: number | null | undefined): string {
  return LEVELS.find((l) => l.level === level)?.name ?? "Unrated";
}

export function levelRange(min: number, max: number): string {
  return min === max ? `Lv.${min}` : `Lv.${min}–${max}`;
}

/** Bangkok areas, matching the court filter on rallyz.club. */
export const AREAS = [
  "Thonglor",
  "Ekkamai",
  "Asok",
  "Phrom Phong",
  "Silom",
  "Sathorn",
  "Lumphini",
  "Ari",
  "Ladprao",
  "Ratchada",
  "Rama 9",
  "On Nut",
  "Other",
] as const;

export const EVENT_TYPES = [
  { value: "practice", label: "Practice" },
  { value: "match_play", label: "Match play" },
  { value: "lesson", label: "Group lesson" },
  { value: "tournament", label: "Tournament" },
  { value: "social", label: "Social" },
] as const;

export const FORMATS = [
  { value: "doubles", label: "Doubles" },
  { value: "singles", label: "Singles" },
  { value: "mixed", label: "Mixed doubles" },
] as const;

export const LANGUAGES = ["English", "Thai", "Chinese", "Japanese", "Korean", "French", "German", "Spanish", "Russian"] as const;

export function eventTypeLabel(value: string): string {
  return EVENT_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function formatLabel(value: string): string {
  return FORMATS.find((f) => f.value === value)?.label ?? value;
}

export function baht(amount: number | null | undefined): string {
  if (!amount) return "Free";
  return `฿${amount.toLocaleString("en-US")}`;
}

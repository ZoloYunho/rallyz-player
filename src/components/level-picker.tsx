import { LEVELS } from "@/lib/constants";

/** Radio cards for choosing a level. Works without JavaScript. */
export function LevelPicker({ name = "level", defaultValue }: { name?: string; defaultValue?: number | null }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {LEVELS.map((l) => (
        <label
          key={l.level}
          className="flex cursor-pointer gap-3 rounded-xl border border-line bg-white p-3 has-[:checked]:border-court has-[:checked]:bg-court-50"
        >
          <input
            type="radio"
            name={name}
            value={l.level}
            defaultChecked={defaultValue === l.level}
            required
            className="mt-1 accent-[var(--color-court)]"
          />
          <span>
            <span className="block text-sm font-semibold">
              <span className="font-mono">Lv.{l.level}</span> {l.name}{" "}
              <span className="font-normal text-muted">· NTRP {l.ntrp}</span>
            </span>
            <span className="block text-xs text-muted">{l.description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export function AreaChips({
  name = "areas",
  areas,
  defaultValue = [],
}: {
  name?: string;
  areas: readonly string[];
  defaultValue?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {areas.map((a) => (
        <label
          key={a}
          className="cursor-pointer rounded-full border border-line bg-white px-3 py-1 text-sm has-[:checked]:border-court has-[:checked]:bg-court has-[:checked]:text-white"
        >
          <input type="checkbox" name={name} value={a} defaultChecked={defaultValue.includes(a)} className="sr-only" />
          {a}
        </label>
      ))}
    </div>
  );
}

/** Checkbox chips with separate values and labels (play times, formats). */
export function ChoiceChips({
  name,
  options,
  defaultValue = [],
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          className="cursor-pointer rounded-full border border-line bg-white px-3 py-1 text-sm has-[:checked]:border-court has-[:checked]:bg-court has-[:checked]:text-white"
        >
          <input type="checkbox" name={name} value={o.value} defaultChecked={defaultValue.includes(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

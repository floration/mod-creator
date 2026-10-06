/**
 * Converting between a 3x3 crafting table (nine slots, each an item ref or null) and the
 * `pattern` + `key` a shaped recipe spec stores. Browser-safe: the app's recipe editor uses it.
 */
export type Slots = (string | null)[];

export const EMPTY_SLOTS: Slots = Array(9).fill(null);

/** Lay a pattern out in the top-left of the table. Letters missing from the key become `?<letter>`. */
export function slotsFromPattern(pattern: string[], key: Record<string, string>): Slots {
  const slots: Slots = [...EMPTY_SLOTS];
  pattern.slice(0, 3).forEach((row, r) => {
    [...row].slice(0, 3).forEach((ch, c) => {
      if (ch !== " ") slots[r * 3 + c] = key[ch] ?? `?${ch}`;
    });
  });
  return slots;
}

/** Shapeless ingredients fill the table left to right, top to bottom. */
export function slotsFromList(ingredients: string[]): Slots {
  return EMPTY_SLOTS.map((_, i) => ingredients[i] ?? null);
}

export function listFromSlots(slots: Slots): string[] {
  return slots.filter((s): s is string => !!s);
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Turn the table into `pattern` and `key`. Empty rows and columns around the shape are dropped,
 * which is how Minecraft makes a shaped recipe work anywhere in the table. Letters already in
 * `previousKey` are kept for the same item so hand-edited files don't churn.
 */
export function patternFromSlots(slots: Slots, previousKey: Record<string, string> = {}): { pattern: string[]; key: Record<string, string> } {
  const filled = slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  if (filled.length === 0) return { pattern: ["   ", "   ", "   "], key: {} };
  const rows = filled.map((i) => Math.floor(i / 3));
  const cols = filled.map((i) => i % 3);
  const [r0, r1, c0, c1] = [Math.min(...rows), Math.max(...rows), Math.min(...cols), Math.max(...cols)];

  const key: Record<string, string> = {};
  const letterFor = new Map<string, string>();
  for (const [letter, ref] of Object.entries(previousKey)) if (!letterFor.has(ref)) letterFor.set(ref, letter);
  const used = new Set(slots.filter((s): s is string => !!s?.startsWith("?")).map((s) => s[1]));
  const pick = (ref: string): string => {
    const kept = letterFor.get(ref);
    if (kept && !used.has(kept)) return kept;
    const path = ref.replace(/^#/, "").split(":").pop() ?? "";
    const initial = path.match(/[a-z0-9]/i)?.[0]?.toUpperCase();
    if (initial && !used.has(initial)) return initial;
    return [...LETTERS].find((l) => !used.has(l))!;
  };
  const assigned = new Map<string, string>();

  const pattern: string[] = [];
  for (let r = r0; r <= r1; r++) {
    let row = "";
    for (let c = c0; c <= c1; c++) {
      const ref = slots[r * 3 + c];
      if (!ref) {
        row += " ";
        continue;
      }
      // A letter the key never defined stays as it is, so the file still shows the problem.
      if (ref.startsWith("?")) {
        row += ref[1];
        continue;
      }
      let letter = assigned.get(ref);
      if (!letter) {
        letter = pick(ref);
        used.add(letter);
        assigned.set(ref, letter);
        key[letter] = ref;
      }
      row += letter;
    }
    pattern.push(row);
  }
  return { pattern, key };
}

/** True when both describe the same recipe shape (same items, same relative positions). */
export function sameShape(a: Slots, b: Slots): boolean {
  const norm = (s: Slots) => {
    const { pattern, key } = patternFromSlots(s);
    return JSON.stringify(slotsFromPattern(pattern, key));
  };
  return norm(a) === norm(b);
}

/**
 * Tweaks: numbers a game exposes for tuning by eye in the dev panel (the dev
 * server only; see `devgui.ts`). A game asks for one once and reads `.value`
 * whenever it needs it, so a slider change shows up on the next frame. Values
 * persist in localStorage, so they survive the reload a zoom change needs, and
 * win over the game's own until reset (the panel's "defaults" buttons).
 */
export interface Tweak {
  readonly group: string;
  readonly name: string;
  value: number;
  /** What the game asks for: `value` until a slider moves it (and back on a reset). */
  readonly initial: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Names for the whole numbers 0, 1, 2...: a choice, not an amount. */
  readonly options?: readonly string[];
}

const KEY = 'glyphbox.tweaks';
const load = (): Record<string, number> => {
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV !== true) return {};
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
};
const saved = load();
const registry = new Map<string, Tweak>();
const listeners = new Set<(t: Tweak) => void>();

/**
 * A tunable number, under `group` in the panel. The same group and name always give the same one.
 * Pass `options` instead of a range for a choice: `value` is then the chosen one's index.
 */
export const tweak = (
  group: string,
  name: string,
  value: number,
  range: { readonly min: number; readonly max: number; readonly step?: number } | { readonly options: readonly string[] },
): Tweak => {
  const id = `${group}/${name}`;
  let t = registry.get(id);
  if (t === undefined) {
    const kept = saved[id];
    const kind = 'options' in range ? { min: 0, max: range.options.length - 1, step: 1, options: range.options } : { min: range.min, max: range.max, step: range.step ?? 0.01 };
    t = { group, name, value: typeof kept === 'number' ? kept : value, initial: value, ...kind };
    registry.set(id, t);
    for (const l of listeners) l(t);
  }
  return t;
};

/** Remember a tweak's current value (the panel calls this on change). */
export const keepTweak = (t: Tweak): void => {
  saved[`${t.group}/${t.name}`] = t.value;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked: the value still holds until the page reloads.
  }
};

/** Put a tweak back to what the game asks for, and forget the value kept for it. */
export const resetTweak = (t: Tweak): void => {
  t.value = t.initial;
  delete saved[`${t.group}/${t.name}`];
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked: nothing was kept anyway.
  }
};

/** Every tweak so far, then each new one as a game registers it. Returns an unsubscribe. */
export const watchTweaks = (on: (t: Tweak) => void): (() => void) => {
  for (const t of registry.values()) on(t);
  listeners.add(on);
  return () => void listeners.delete(on);
};

/**
 * Camera zoom for every game: how big a virtual pixel is. Over 1 is closer (fewer
 * pixels, so fewer cells on screen), under 1 shows more of the world. The virtual
 * screen is fixed when the page boots, so changing it reloads the page.
 */
export const ZOOM = tweak('camera', 'zoom', 1, { min: 0.5, max: 2, step: 0.05 });

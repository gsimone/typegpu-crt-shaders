export type Control = { group: string; name: string; value: number; initial: number };

export function createControls() {
  const values: Control[] = [];
  return {
    values,
    tweak(group: string, name: string, initial: number, _range: unknown) {
      const control = { group, name, initial, value: initial };
      values.push(control);
      return control;
    },
  };
}

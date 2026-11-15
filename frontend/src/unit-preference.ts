const key = "achillea-selected-unit";
export function initialUnit(): string {
  try {
    const saved = localStorage.getItem(key);
    return saved === "ICU" || saved === "L_AND_D" ? saved : "ICU";
  } catch {
    return "ICU";
  }
}
export function saveUnit(unit: string) {
  try {
    localStorage.setItem(key, unit);
  } catch {
    /* Unit switching still works without browser storage. */
  }
}

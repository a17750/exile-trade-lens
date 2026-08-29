export function countPlaceholders(value) {
  return (String(value ?? "").match(/#/g) ?? []).length;
}

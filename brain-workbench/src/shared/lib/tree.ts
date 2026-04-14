export function groupBy<T extends Record<string, unknown>>(items: T[], key: keyof T): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((accumulator, item) => {
    const bucket = String(item[key] ?? "unknown");
    accumulator[bucket] = [...(accumulator[bucket] ?? []), item];
    return accumulator;
  }, {});
}

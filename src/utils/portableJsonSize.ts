export const MAX_PORTABLE_JSON_BYTES = 256 * 1024 * 1024;
const SIZE_ERROR = "This JSON backup would exceed the 256 MiB size limit. Remove unneeded Restore Points and try again. No data was omitted.";

/** Measure escaped UTF-8 JSON without allocating another copy of audio strings. */
function stringBytes(value: string): number {
  if (!/["\\\u0000-\u001f\u007f-\uffff]/.test(value)) return value.length + 2;
  let size = 2;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === '"' || character === "\\" || [8, 9, 10, 12, 13].includes(code)) size += 2;
    else if (code < 32 || (code >= 0xd800 && code <= 0xdfff)) size += 6;
    else size += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
  }
  return size;
}

/** Parts may be added incrementally, so oversized audio histories stop loading early. */
export class PortableJsonBudget {
  private used = 0;
  constructor(private readonly limit = MAX_PORTABLE_JSON_BYTES) {}

  get bytes(): number { return this.used; }

  add(value: unknown, depth = 0): void {
    const seen = new Set<object>();
    const count = (bytes: number) => {
      this.used += bytes;
      if (this.used > this.limit) throw new Error(SIZE_ERROR);
    };
    const visit = (item: unknown, level: number) => {
      if (level > 64) throw new Error("The backup contains excessively nested data.");
      if (item === null || item === undefined) { count(4); return; }
      if (typeof item === "string") { count(stringBytes(item)); return; }
      if (typeof item === "boolean") { count(item ? 4 : 5); return; }
      if (typeof item === "number") { count(Number.isFinite(item) ? String(item).length : 4); return; }
      if (typeof item !== "object" || seen.has(item)) throw new Error("The backup contains unsupported data.");
      seen.add(item);
      try {
        const array = Array.isArray(item);
        const entries: [string, unknown][] = array ? item.map((entry, index) => [String(index), entry])
          : Object.entries(item).filter(([, entry]) => entry !== undefined);
        if (!entries.length) { count(2); return; }
        count(4 + level * 2 + (entries.length - 1) * 2); // braces, newlines, closing indentation and commas
        for (const [key, entry] of entries) {
          count((level + 1) * 2 + (array ? 0 : stringBytes(key) + 2));
          visit(entry, level + 1);
        }
      } finally { seen.delete(item); }
    };
    visit(value, depth);
  }
}

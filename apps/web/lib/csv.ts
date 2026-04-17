import "server-only";

/**
 * Minimal RFC 4180 CSV writer. Avoids pulling a dependency for the common case.
 *
 * `columns` is the header row (in order). Rows are objects keyed by column.
 * Values are coerced to strings via `format` with sane defaults; `null` and
 * `undefined` render as empty fields.
 */
export function writeCsv(
  columns: readonly string[],
  rows: ReadonlyArray<Record<string, unknown>>,
  format: (col: string, v: unknown) => string = defaultFormat,
): string {
  const lines: string[] = [];
  lines.push(columns.map(quote).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => quote(format(c, row[c]))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function defaultFormat(_col: string, v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function quote(v: string): string {
  // RFC 4180: quote if field contains comma, quote, or newline; double inner quotes.
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

/**
 * Stable in-place sort by an enum value's name. PostgreSQL orders native enums by declaration
 * order, so listings that group by an enum sort here to keep their alphabetical grouping.
 * Rows that tie keep the order the database returned them in.
 */
export function sortByEnumName<T>(rows: T[], key: (row: T) => string): T[] {
  return rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

import { sql, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Names a column without its table. A table rebuild creates the new table under a temporary name,
 * so a CHECK that names its table fails there.
 */
export const column = (target: AnySQLiteColumn): SQL => sql`${sql.identifier(target.name)}`;

export const booleanCheck = (target: AnySQLiteColumn): SQL => sql`${column(target)} in (0, 1)`;

/** Use only for value lists that the schema owns. Validate open value lists in the contracts. */
export const enumCheck = (target: AnySQLiteColumn, values: readonly string[]): SQL =>
  sql`${column(target)} in (${sql.raw(values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", "))})`;

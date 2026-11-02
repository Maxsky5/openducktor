import { sql } from "drizzle-orm";

// Node and Electron accept fewer parameters than Bun. Keep batches within their limit.
const MAX_PARAMETERS = 32766;

export function* sqliteBatches<T>(
  values: readonly T[],
  parametersPerValue = 1,
  fixedParameters = 0,
): Generator<T[]> {
  const size = Math.floor((MAX_PARAMETERS - fixedParameters) / parametersPerValue);
  for (let offset = 0; offset < values.length; offset += size)
    yield values.slice(offset, offset + size);
}

// JSON arrays keep unbounded IN lists in one statement without one bind per item.
export const sqliteValues = (values: readonly (string | number)[]) =>
  sql`(select value from json_each(${JSON.stringify(values)}))`;

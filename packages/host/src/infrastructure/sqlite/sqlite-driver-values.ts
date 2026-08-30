import { z } from "zod";

export type SqliteValue = bigint | number | string | null | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;
export type SqliteValueRow = SqliteValue[];

export const sqliteValueSchema: z.ZodType<SqliteValue> = z.union([
  z.bigint(),
  z.number(),
  z.string(),
  z.null(),
  z.instanceof(Uint8Array),
]);

export const sqliteRowSchema: z.ZodType<SqliteRow> = z
  .record(z.string(), sqliteValueSchema)
  .refine((value) => {
    const prototype: object | null = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  });

export const sqliteValueRowSchema: z.ZodType<SqliteValueRow> = z.array(sqliteValueSchema);

export const sqliteRunResultSchema = z.object({
  changes: z.union([z.bigint(), z.number()]),
  lastInsertRowid: z.union([z.bigint(), z.number()]),
});

export type SqliteRunResult = z.output<typeof sqliteRunResultSchema>;

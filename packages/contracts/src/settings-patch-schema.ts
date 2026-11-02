import { z } from "zod";

export type SetOrClear<T> = { type: "set"; value: T } | { type: "clear" };
export type SettingsFieldsPatch<T> = {
  [Key in keyof T]?:
    | (undefined extends T[Key]
        ? SetOrClear<SettingsFieldValue<Exclude<T[Key], undefined>>>
        : SettingsFieldValue<T[Key]>)
    | undefined;
};
type SettingsFieldValue<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? string extends keyof T
      ? T
      : SettingsFieldsPatch<T>
    : T;

export const setOrClearSchema = <Schema extends z.core.$ZodType>(value: Schema) =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("set"), value }),
    z.strictObject({ type: z.literal("clear") }),
  ]);

/** Keeps the current field constraints, removes defaults, and makes omission mean unchanged. */
export const settingsFieldsPatchSchema = <Fields extends Record<string, z.core.$ZodType>>(
  schema: z.ZodObject<Fields>,
): z.ZodObject<{
  [Key in keyof Fields]: z.ZodOptional<
    z.ZodType<SettingsFieldsPatch<z.output<typeof schema>>[Key & keyof z.output<typeof schema>]>
  >;
}> => {
  const fields: Record<string, z.core.$ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let value = field;
    if (value instanceof z.ZodDefault) value = value.removeDefault();
    // Legacy null-to-optional fields must retain clear intent before their preprocess runs.
    if (value instanceof z.ZodPipe && value.out instanceof z.ZodOptional) value = value.out;
    const optional = value instanceof z.ZodOptional;
    if (value instanceof z.ZodOptional) value = value.unwrap();
    if (value instanceof z.ZodObject) value = settingsFieldsPatchSchema(value);
    fields[key] = z.optional(optional ? setOrClearSchema(value) : value);
  }
  // SAFETY: Each source field becomes optional and retains its validator; optional values use the matching set-or-clear validator.
  return z.strictObject(fields) as z.ZodObject<{
    [Key in keyof Fields]: z.ZodOptional<
      z.ZodType<SettingsFieldsPatch<z.output<typeof schema>>[Key & keyof z.output<typeof schema>]>
    >;
  }>;
};

export const keyedSettingsEditsSchema = <
  Create extends z.core.$ZodType,
  Patch extends z.core.$ZodType,
>(
  create: Create,
  patch: Patch,
) =>
  z.strictObject({
    create: z.record(z.string().min(1), create).optional(),
    update: z.record(z.string().min(1), patch).optional(),
    remove: z.array(z.string().min(1)).optional(),
  });

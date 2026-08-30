import { z, type JSONType } from "zod";

export type OpenCodeProtocolValue = JSONType;
export type OpenCodeProtocolObject = Record<string, OpenCodeProtocolValue>;

export const opencodeProtocolValueSchema = z.json();
export const opencodeProtocolObjectSchema = z.record(z.string(), opencodeProtocolValueSchema);

export const asJsonObject = (
  value: OpenCodeProtocolValue | undefined,
): OpenCodeProtocolObject | undefined => {
  const parsed = opencodeProtocolObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

export const readStringProp = (
  source: OpenCodeProtocolValue | undefined,
  keys: readonly string[],
): string | undefined => {
  const record = asJsonObject(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = z.string().safeParse(record[key]);
    if (value.success && value.data.length > 0) {
      return value.data;
    }
  }
  return undefined;
};

export const readNumberProp = (
  source: OpenCodeProtocolValue | undefined,
  keys: string[],
): number | undefined => {
  const record = asJsonObject(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = z.number().finite().safeParse(record[key]);
    if (value.success) {
      return value.data;
    }
  }
  return undefined;
};

export const readBooleanProp = (
  source: OpenCodeProtocolValue | undefined,
  keys: string[],
): boolean | undefined => {
  const record = asJsonObject(source);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = z.boolean().safeParse(record[key]);
    if (value.success) {
      return value.data;
    }
  }
  return undefined;
};

export const readStringArrayProp = (
  source: OpenCodeProtocolValue | undefined,
  key: string,
): string[] | undefined => {
  const record = asJsonObject(source);
  const values = z.array(z.string()).safeParse(record?.[key]);
  return values.success ? values.data : undefined;
};
